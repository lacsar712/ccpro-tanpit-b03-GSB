from django.db import transaction
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, User, Yard
from pits.rules import RuleError, assert_can_set_status, latest_ph

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class ChecksIn(Schema):
    # 三项必须显式传布尔；缺项由 Schema 校验拦下，空清单不会被当成已齐。
    cover_closed: bool
    scraper_stowed: bool
    rail_reset: bool


def pit_json(pit: Pit) -> dict:
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "coverClosed": pit.cover_closed,
        "scraperStowed": pit.scraper_stowed,
        "railReset": pit.rail_reset,
    }


def require_admin(user: User) -> None:
    if user.role != "admin":
        raise HttpError(403, "仅管理员可勾改放液三勾清单")


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    yard = Yard.objects.prefetch_related("pits__samples").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/checks", auth=auth)
def set_checks(request, pit_id: int, payload: ChecksIn):
    # 放液三勾只有管理员能勾、能改；操作工只读。
    require_admin(request.auth)
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.cover_closed = payload.cover_closed
    pit.scraper_stowed = payload.scraper_stowed
    pit.rail_reset = payload.rail_reset
    pit.save(update_fields=["cover_closed", "scraper_stowed", "rail_reset"])
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    # 行锁串行化同一坑的状态变更：两人抢标已放液时，只许一口成功。
    with transaction.atomic():
        pit = Pit.objects.select_for_update().filter(id=pit_id).first()
        if pit is None:
            raise HttpError(404, "坑不存在")
        if payload.status == Pit.STATUS_DRAINED and pit.status == Pit.STATUS_DRAINED:
            raise HttpError(409, "该坑已是已放液状态")
        try:
            assert_can_set_status(pit, payload.status)
        except RuleError as exc:
            raise HttpError(400, str(exc))
        pit.status = payload.status
        pit.save(update_fields=["status"])
    pit.refresh_from_db()
    return pit_json(pit)
