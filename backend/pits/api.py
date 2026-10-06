from django.db import transaction
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import DrainChecklist, Pit, User, Yard
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


class ChecklistIn(Schema):
    cover_closed: bool
    scraper_stowed: bool
    guard_restored: bool


def checklist_json(checklist: DrainChecklist | None) -> dict:
    if checklist is None:
        # 没有记录就是三勾全未勾，不能被前端当成已齐
        return {
            "coverClosed": False,
            "scraperStowed": False,
            "guardRestored": False,
            "updatedBy": "",
            "updatedAt": None,
        }
    return {
        "coverClosed": checklist.cover_closed,
        "scraperStowed": checklist.scraper_stowed,
        "guardRestored": checklist.guard_restored,
        "updatedBy": checklist.updated_by,
        "updatedAt": checklist.updated_at.isoformat(),
    }


def pit_json(pit: Pit) -> dict:
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "checks": checklist_json(getattr(pit, "checklist", None)),
    }


def require_admin(request) -> None:
    if request.auth.role != "admin":
        raise HttpError(403, "只有管理员能勾改放液三勾")


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
    yard = Yard.objects.prefetch_related("pits__samples", "pits__checklist").first()
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


@api.put("/pits/{pit_id}/checklist", auth=auth)
def update_checklist(request, pit_id: int, payload: ChecklistIn):
    require_admin(request)
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    with transaction.atomic():
        checklist, _ = DrainChecklist.objects.select_for_update().get_or_create(pit=pit)
        checklist.cover_closed = payload.cover_closed
        checklist.scraper_stowed = payload.scraper_stowed
        checklist.guard_restored = payload.guard_restored
        checklist.updated_by = request.auth.username
        checklist.save()
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    # 锁住该坑行再校验再落状态：两人同时点已放液，只有一个能完成转换
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
