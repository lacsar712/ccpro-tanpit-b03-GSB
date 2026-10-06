"""鞣坑放液门槛：
1. 最近一次浸液酸碱度须在 3.5～5.0；
2. 放液三勾（渠盖已盖、刮板已收、护栏已复位）须全部勾上。

无三勾记录或勾不全，一律视为未齐，不得放液。
登记酸碱度、改成鞣制中不走这里的三勾校验。
"""

from pits.models import Pit

MIN_PH = 3.5
MAX_PH = 5.0

CHECK_ITEMS = ("cover_closed", "scraper_stowed", "guard_restored")
CHECK_LABELS = {
    "cover_closed": "渠盖已盖",
    "scraper_stowed": "刮板已收",
    "guard_restored": "护栏已复位",
}


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def missing_checks(pit: Pit) -> list[str]:
    """返回未勾项的中文名。没有清单记录时三项全缺——空清单不等于已齐。"""
    checklist = getattr(pit, "checklist", None)
    if checklist is None:
        return [CHECK_LABELS[key] for key in CHECK_ITEMS]
    return [CHECK_LABELS[key] for key in CHECK_ITEMS if not getattr(checklist, key)]


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status != Pit.STATUS_DRAINED:
        return
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
    missing = missing_checks(pit)
    if missing:
        raise RuleError("放液三勾未齐（缺：" + "、".join(missing) + "），不能放液")
