-- ============================================================
-- BSSBMS - Bar Stock, Sales and Business Management System
-- MySQL Database Schema (Production-ready for Rwanda bars/shops)
-- ============================================================

CREATE DATABASE IF NOT EXISTS bssbms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bssbms;

-- -----------------------------------------------------------
-- USERS & AUTHENTICATION
-- -----------------------------------------------------------
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,          -- admin, manager, cashier, stock_keeper
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL UNIQUE,
  email VARCHAR(120) UNIQUE,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- -----------------------------------------------------------
-- BUSINESS / LOCATION (future multi-location support)
-- -----------------------------------------------------------
CREATE TABLE businesses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  address TEXT,
  phone VARCHAR(20),
  email VARCHAR(120),
  tin VARCHAR(50),                            -- Rwanda TIN
  currency VARCHAR(5) DEFAULT 'RWF',
  logo_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------
-- SUPPLIERS
-- -----------------------------------------------------------
CREATE TABLE suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(120),
  address TEXT,
  notes TEXT,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------
-- PRODUCT CATEGORIES & UNITS
-- -----------------------------------------------------------
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,           -- bottle, crate, pack, piece, liter, etc.
  abbreviation VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unit conversion factors (e.g. 1 crate = 24 bottles)
CREATE TABLE unit_conversions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_unit_id INT NOT NULL,
  to_unit_id INT NOT NULL,
  factor DECIMAL(12,4) NOT NULL,              -- e.g. 24 for crate -> bottle
  UNIQUE KEY unique_conversion (from_unit_id, to_unit_id),
  FOREIGN KEY (from_unit_id) REFERENCES units(id),
  FOREIGN KEY (to_unit_id) REFERENCES units(id)
);

-- -----------------------------------------------------------
-- PRODUCTS
-- -----------------------------------------------------------
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT,
  name VARCHAR(150) NOT NULL,
  sku VARCHAR(50) UNIQUE,
  barcode VARCHAR(50),
  description TEXT,
  base_unit_id INT NOT NULL,                  -- smallest tracking unit (usually bottle)
  purchase_unit_id INT,                       -- common purchase unit (crate)
  sale_unit_id INT,                           -- common sale unit
  cost_price DECIMAL(12,2) DEFAULT 0,         -- per base unit
  selling_price DECIMAL(12,2) DEFAULT 0,      -- per base unit
  min_stock_level DECIMAL(12,3) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  track_stock TINYINT(1) DEFAULT 1,
  image_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (base_unit_id) REFERENCES units(id),
  FOREIGN KEY (purchase_unit_id) REFERENCES units(id) ON DELETE SET NULL,
  FOREIGN KEY (sale_unit_id) REFERENCES units(id) ON DELETE SET NULL
);

-- -----------------------------------------------------------
-- STOCK / INVENTORY
-- -----------------------------------------------------------
CREATE TABLE stock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL UNIQUE,
  quantity DECIMAL(14,3) NOT NULL DEFAULT 0,  -- always in base unit
  reserved_quantity DECIMAL(14,3) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE stock_movements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  movement_type ENUM('purchase','sale','adjustment','return','transfer','waste') NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,            -- positive = in, negative = out (base unit)
  reference_type VARCHAR(50),                 -- purchase, sale, adjustment
  reference_id BIGINT,
  unit_cost DECIMAL(12,2),
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_product_date (product_id, created_at),
  INDEX idx_reference (reference_type, reference_id)
);

-- -----------------------------------------------------------
-- PURCHASES
-- -----------------------------------------------------------
CREATE TABLE purchases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT,
  invoice_number VARCHAR(80),
  purchase_date DATE NOT NULL,
  status ENUM('draft','received','partial','cancelled') DEFAULT 'received',
  subtotal DECIMAL(14,2) DEFAULT 0,
  tax_amount DECIMAL(14,2) DEFAULT 0,
  discount_amount DECIMAL(14,2) DEFAULT 0,
  total_amount DECIMAL(14,2) DEFAULT 0,
  amount_paid DECIMAL(14,2) DEFAULT 0,
  balance DECIMAL(14,2) DEFAULT 0,            -- amount still owed to supplier
  payment_status ENUM('unpaid','partial','paid') DEFAULT 'unpaid',
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE purchase_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  purchase_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,            -- in the unit used for this purchase
  unit_id INT NOT NULL,
  quantity_base DECIMAL(14,3) NOT NULL,       -- converted to base unit
  unit_cost DECIMAL(12,2) NOT NULL,           -- cost per purchased unit
  total_cost DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
);

CREATE TABLE supplier_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  purchase_id BIGINT,                         -- optional link to specific purchase
  amount DECIMAL(14,2) NOT NULL,
  payment_method ENUM('cash','mobile_money','bank','cheque','other') DEFAULT 'cash',
  payment_date DATE NOT NULL,
  reference VARCHAR(100),
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- -----------------------------------------------------------
-- CUSTOMERS & CREDIT / DEBT
-- -----------------------------------------------------------
CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(120),
  address TEXT,
  credit_limit DECIMAL(14,2) DEFAULT 0,
  notes TEXT,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE customer_debts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  sale_id BIGINT,                             -- link to sale that created the debt
  original_amount DECIMAL(14,2) NOT NULL,
  remaining_amount DECIMAL(14,2) NOT NULL,
  status ENUM('open','partial','paid','written_off') DEFAULT 'open',
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE customer_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  debt_id BIGINT,
  amount DECIMAL(14,2) NOT NULL,
  payment_method ENUM('cash','mobile_money','bank','cheque','other') DEFAULT 'cash',
  payment_date DATE NOT NULL,
  reference VARCHAR(100),
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (debt_id) REFERENCES customer_debts(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- -----------------------------------------------------------
-- SALES / POS
-- -----------------------------------------------------------
CREATE TABLE sales (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  receipt_number VARCHAR(30) NOT NULL UNIQUE,
  customer_id INT,                            -- null = walk-in
  sale_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('completed','held','cancelled','refunded') DEFAULT 'completed',
  subtotal DECIMAL(14,2) DEFAULT 0,
  tax_amount DECIMAL(14,2) DEFAULT 0,
  discount_amount DECIMAL(14,2) DEFAULT 0,
  total_amount DECIMAL(14,2) DEFAULT 0,
  amount_paid DECIMAL(14,2) DEFAULT 0,
  change_given DECIMAL(14,2) DEFAULT 0,
  payment_method ENUM('cash','mobile_money','card','credit','mixed') DEFAULT 'cash',
  payment_status ENUM('paid','partial','credit') DEFAULT 'paid',
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sale_date (sale_date),
  INDEX idx_receipt (receipt_number)
);

CREATE TABLE sale_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_id INT NOT NULL,
  quantity_base DECIMAL(14,3) NOT NULL,       -- converted to base unit
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) DEFAULT 0,
  total_price DECIMAL(14,2) NOT NULL,
  cost_at_sale DECIMAL(12,2),                 -- for profit calculation
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
);

CREATE TABLE sale_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT NOT NULL,
  payment_method ENUM('cash','mobile_money','card','credit','other') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reference VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------
-- EXPENSES
-- -----------------------------------------------------------
CREATE TABLE expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expenses (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category_id INT,
  title VARCHAR(200) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  payment_method ENUM('cash','mobile_money','bank','other') DEFAULT 'cash',
  reference VARCHAR(100),
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_expense_date (expense_date)
);

-- -----------------------------------------------------------
-- CASH MANAGEMENT / RECONCILIATION
-- -----------------------------------------------------------
CREATE TABLE cash_registers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,                 -- e.g. Main Counter, Bar 1
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cash_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  register_id INT NOT NULL,
  opened_by INT NOT NULL,
  closed_by INT,
  opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  closing_balance DECIMAL(14,2),
  expected_cash DECIMAL(14,2),
  actual_cash DECIMAL(14,2),
  difference DECIMAL(14,2),
  status ENUM('open','closed') DEFAULT 'open',
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  notes TEXT,
  FOREIGN KEY (register_id) REFERENCES cash_registers(id),
  FOREIGN KEY (opened_by) REFERENCES users(id),
  FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE cash_movements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT,
  movement_type ENUM('sale','purchase_payment','expense','customer_payment','supplier_payment','cash_in','cash_out','adjustment') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,              -- positive = in, negative = out
  reference_type VARCHAR(50),
  reference_id BIGINT,
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES cash_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- -----------------------------------------------------------
-- AUDIT LOG (important for production)
-- -----------------------------------------------------------
CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id BIGINT,
  old_values JSON,
  new_values JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_user_date (user_id, created_at)
);

-- -----------------------------------------------------------
-- SEED DATA
-- -----------------------------------------------------------
INSERT INTO roles (name, description) VALUES
('admin', 'Full system access'),
('manager', 'Manage inventory, purchases, reports, users'),
('cashier', 'POS sales and basic customer operations'),
('stock_keeper', 'Inventory and stock adjustments');

INSERT INTO units (name, abbreviation) VALUES
('Bottle', 'btl'),
('Crate', 'crt'),
('Pack', 'pk'),
('Piece', 'pc'),
('Liter', 'L'),
('Half-liter', '0.5L'),
('Can', 'can'),
('Case', 'case');

-- Common conversions (crate of 24 bottles is very common in Rwanda)
INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor)
SELECT f.id, t.id, 24 FROM units f, units t WHERE f.name = 'Crate' AND t.name = 'Bottle';

INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor)
SELECT f.id, t.id, 12 FROM units f, units t WHERE f.name = 'Case' AND t.name = 'Can';

INSERT INTO categories (name) VALUES
('Beer'),
('Soft Drinks'),
('Water'),
('Spirits'),
('Wine'),
('Juice'),
('Other');

INSERT INTO expense_categories (name) VALUES
('Rent'),
('Utilities'),
('Salaries'),
('Transport'),
('Maintenance'),
('Marketing'),
('Miscellaneous');

INSERT INTO cash_registers (name) VALUES ('Main Counter');

-- Default admin user (password: Admin@123) - CHANGE IMMEDIATELY IN PRODUCTION
-- bcrypt hash of Admin@123
INSERT INTO users (role_id, full_name, username, email, password_hash)
SELECT r.id, 'System Administrator', 'admin', 'admin@bssbms.rw',
       '$2a$10$rQZ8K8Y5Y5Y5Y5Y5Y5Y5YuGKxGKxGKxGKxGKxGKxGKxGKxGKxGKxG'  -- placeholder, will be set properly
FROM roles r WHERE r.name = 'admin';
