# BSSBMS — Bar Stock, Sales and Business Management System

Production-ready business management system for small bars and beverage shops in Rwanda.

## Quick Start (Working Project)

### 1. Import the Database (one command)

```bash
mysql -u root -p < backend/sql/bssbms_full.sql
```

This creates the full database with:
- All tables
- Admin + Manager + Cashier users
- Realistic products (Primus, Mützig, Coca-Cola, Inyange water, etc.)
- Starting stock
- Sample purchases, sales, customers, debts and expenses

**Login credentials (all users):**
- Username: `admin`     Password: `Admin@123`
- Username: `manager`   Password: `Admin@123`
- Username: `cashier`   Password: `Admin@123`

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — set your MySQL password:
#   DB_PASSWORD=your_mysql_password
#   JWT_SECRET=any_long_random_string_here

npm install
npm run dev
# API → http://localhost:5000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# App → http://localhost:5173
```

Open http://localhost:5173 and login with **admin / Admin@123**

---

## What is included

### Features
- Secure login with roles (Admin, Manager, Cashier, Stock Keeper)
- Modern Dashboard
- Full Point of Sale (POS) with cash / mobile money / credit
- Product & stock management with crate ↔ bottle conversion
- Purchases from suppliers
- Customer credit & debt tracking
- Expenses
- Sales & profit reports
- Cash session support

### Tech Stack
- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express
- Database: MySQL 8

### Database file
Use **only** this file to import:

```
backend/sql/bssbms_full.sql
```

It is a complete ready-to-use dump (schema + sample data).

---

## Default Users

| Username  | Password   | Role     |
|-----------|------------|----------|
| admin     | Admin@123  | Admin    |
| manager   | Admin@123  | Manager  |
| cashier   | Admin@123  | Cashier  |

**Important:** Change the admin password after first login in production.

---

## Project Structure

```
bssbms/
├── backend/
│   ├── sql/bssbms_full.sql     ← Import this
│   ├── .env.example
│   └── src/
└── frontend/
    └── src/
```

## Production Checklist
- [ ] Change default passwords
- [ ] Set a strong JWT_SECRET in .env
- [ ] Configure database backups
- [ ] Use HTTPS
- [ ] Set NODE_ENV=production
