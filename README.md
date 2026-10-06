# TanPit-01 · 南冈鞣场

鞣坑场地图作业台。登录后是按行列铺开的坑位，点坑登记浸液酸碱度并改状态。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Django 5 · Django Ninja（不是 DRF 视图集） |
| 结构 | Django app `pits`：models / rules / api 分文件 |
| 数据 | Django ORM · PostgreSQL 15 |
| 前端 | Lit 3 Web Component · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4770
- API：http://localhost:8770
- PostgreSQL：localhost:6170

## 演示账号

`admin` / `123456`，`worker` / `123456`

## 业务规则

- **放液三勾**：每坑须由管理员勾齐「渠盖已盖、刮板已收、护栏已复位」三项（三勾清单在顶栏「放液三勾」独立专页，按坑列出；管理员可勾可改，操作工只读）。
- 坑不可标「已放液」，除非该坑三勾全勾 **且** 最近一次浸液酸碱度在 **3.5～5.0**。三项缺任一项，点「已放液」必然后端拒绝；空勾清单不算齐。
- 登记酸碱度、改成「鞣制中」均不看三勾。
- 两人同时抢标同一坑「已放液」，只许一口成功，另一口收到 409。
- 规则在 `backend/pits/rules.py`，并发串行化在 `backend/pits/api.py` 的状态接口（行锁）。

## 快速启动

```bash
cd TanPit/TanPit-01
docker compose up --build
```
