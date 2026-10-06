import os

os.environ.setdefault("NINJA_SKIP_REGISTRY", "1")

from django.test import TestCase
from ninja.testing import TestClient

from pits.api import api
from pits.auth import make_token
from pits.models import LiquorSample, Pit, User, Yard

client = TestClient(api)


class PitFlowTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(username="admin", role="admin")
        self.admin.set_password("x")
        self.admin.save()
        self.worker = User.objects.create(username="worker", role="worker")
        self.worker.set_password("x")
        self.worker.save()
        self.yard = Yard.objects.create(name="南冈鞣场", village="青皮村")
        self.pit = Pit.objects.create(yard=self.yard, code="东-1", row=0, col=0,
                                      status=Pit.STATUS_TANNING)
        LiquorSample.objects.create(pit=self.pit, ph=4.2, operator="worker")
        self.client = client

    def auth(self, user):
        return {"Authorization": f"Bearer {make_token(user.username)}"}

    def set_checks(self, user, *, cover=True, scraper=True, rail=True, expected=200):
        resp = self.client.post(
            f"/pits/{self.pit.id}/checks",
            json={"cover_closed": cover, "scraper_stowed": scraper, "rail_reset": rail},
            headers=self.auth(user),
        )
        self.assertEqual(resp.status_code, expected, resp.content)
        return resp

    def drain(self, user, expected=200):
        resp = self.client.post(
            f"/pits/{self.pit.id}/status",
            json={"status": "drained"},
            headers=self.auth(user),
        )
        self.assertEqual(resp.status_code, expected, resp.content)
        return resp

    def refresh(self):
        self.pit.refresh_from_db()

    # ---- 三勾与放液 ----

    def test_drain_blocked_when_no_checks(self):
        # 空勾清单不得当成已齐：三项默认 False，放液必败。
        resp = self.drain(self.admin, expected=400)
        self.assertIn("三勾未齐", resp.json()["detail"])
        self.refresh()
        self.assertEqual(self.pit.status, Pit.STATUS_TANNING)

    def test_drain_blocked_when_any_check_missing(self):
        for missing in ("cover", "scraper", "rail"):
            with self.subTest(missing=missing):
                self.set_checks(
                    self.admin,
                    cover=missing != "cover",
                    scraper=missing != "scraper",
                    rail=missing != "rail",
                )
                resp = self.drain(self.admin, expected=400)
                self.assertIn("三勾未齐", resp.json()["detail"])
                self.refresh()
                self.assertEqual(self.pit.status, Pit.STATUS_TANNING)

    def test_drain_allowed_when_all_checks_and_ph_ok(self):
        self.set_checks(self.admin)
        self.drain(self.admin, expected=200)
        self.refresh()
        self.assertEqual(self.pit.status, Pit.STATUS_DRAINED)

    def test_drain_still_blocked_by_bad_ph_even_with_checks(self):
        # 三勾齐了，酸碱度 3.5～5.0 的老规矩照旧。
        self.set_checks(self.admin)
        LiquorSample.objects.create(pit=self.pit, ph=6.1, operator="worker")
        resp = self.drain(self.admin, expected=400)
        self.assertIn("3.5", resp.json()["detail"])
        self.refresh()
        self.assertEqual(self.pit.status, Pit.STATUS_TANNING)

    def test_sample_and_tanning_do_not_require_checks(self):
        # 登记酸碱度、改成鞣制中不看三勾。
        r = self.client.post(
            f"/pits/{self.pit.id}/samples",
            json={"ph": 4.6},
            headers=self.auth(self.worker),
        )
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(
            f"/pits/{self.pit.id}/status",
            json={"status": "tanning"},
            headers=self.auth(self.worker),
        )
        self.assertEqual(r.status_code, 200, r.content)

    # ---- 三勾权限 ----

    def test_worker_cannot_edit_checks(self):
        self.set_checks(self.worker, expected=403)
        self.refresh()
        self.assertFalse(self.pit.cover_closed)

    def test_admin_can_edit_and_uncheck_checks(self):
        self.set_checks(self.admin)
        self.refresh()
        self.assertTrue(self.pit.drain_checks_complete())
        # 管理员可改：勾了也能再撤掉。
        self.set_checks(self.admin, cover=False, scraper=False, rail=False)
        self.refresh()
        self.assertFalse(self.pit.drain_checks_complete())

    def test_checks_payload_must_be_complete(self):
        # 缺项不允许，空清单绝不会被服务端当全 True。
        r = self.client.post(
            f"/pits/{self.pit.id}/checks",
            json={"cover_closed": True},
            headers=self.auth(self.admin),
        )
        self.assertEqual(r.status_code, 422)

    # ---- 重复 / 抢标已放液 ----

    def test_second_drain_conflicts(self):
        self.set_checks(self.admin)
        self.drain(self.admin)
        # 两人抢着标同一坑：第二口必须失败，状态只变一次。
        resp = self.drain(self.worker, expected=409)
        self.assertIn("已是已放液", resp.json()["detail"])

    # ---- 看板带出三勾 ----

    def test_board_includes_checks(self):
        self.set_checks(self.admin, cover=True, scraper=False, rail=True)
        r = self.client.get("/board", headers=self.auth(self.worker))
        self.assertEqual(r.status_code, 200, r.content)
        pit = next(p for p in r.json()["pits"] if p["id"] == self.pit.id)
        self.assertTrue(pit["coverClosed"])
        self.assertFalse(pit["scraperStowed"])
        self.assertTrue(pit["railReset"])
