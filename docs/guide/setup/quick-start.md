---
title: "Quick Start"
description: "Khởi tạo project trong 5 phút"
weight: 1
---

## Quick Start Guide

### Bước 1: Clone repo của đội

Repo của đội đã được tạo sẵn từ template trong org GitHub của khoá — copy URL ở
trang đội trên Phoenix rồi clone về:

```bash
git clone https://github.com/<ORG-CỦA-KHOÁ>/<MÃ-ĐỘI>.git
cd <MÃ-ĐỘI>
```

### Bước 2: Environment Setup

```bash
# Tạo virtual environment
python3.11 -m venv .venv
source .venv/bin/activate  # macOS/Linux

# Cài dependencies
npm ci
PYTHON=$PWD/.venv/bin/python npm run setup:python

# Tạo .env từ template
cp .env.example .env.local
# → Mở .env và điền API keys
```

### Bước 3: Verify Setup

```bash
# Chạy server
npm run dev:agent

# Mở browser: http://localhost:8000/docs
# → Phải thấy Swagger UI
```

### Bước 4: Git Setup

```bash
# Xác nhận remote đã trỏ đúng repo của đội (repo cấp sẵn — không cần set-url)
git remote -v

# Tạo branch develop
git checkout -b develop

# Push lần đầu
git push -u origin develop
```

Cấu hình credentials/service/data theo [development map](../../../DEVELOPMENT.md)
và [local MVP runbook](../../runbooks/local-mvp.md) trước khi chạy.

## Folder Structure

```
<MÃ-ĐỘI>/
├── apps/                   ← Các ứng dụng chạy độc lập
├── packages/               ← Thư viện dùng chung (TS/Python)
├── examples/               ← Streamlit, map và design references
├── tests/                  ← Test suite
├── docs/                   ← Documentation
├── eval/                   ← Evaluation results
├── presentation/           ← Demo materials
├── Dockerfile              ← Multi-stage build
├── docker-compose.yml      ← Full stack
└── .github/workflows/      ← CI/CD
```

## Nguyên tắc tổ chức code

1. **Một file một trách nhiệm** — `graph.py` chỉ build graph, `state.py` chỉ định nghĩa state
2. **Nodes vào folder `nodes/`** — Mỗi node là một file riêng
3. **Tools vào folder `tools/`** — Mỗi tool là một file riêng
4. **API routes tách riêng** — Không trộn logic vào main.py
5. **Config centralized** — Tất cả settings trong `config.py`
