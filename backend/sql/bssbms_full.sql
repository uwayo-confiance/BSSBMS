-- ============================================================
-- BSSBMS - Complete Database (Schema + Sample Data)
-- Ready to import for a Rwandan bar / beverage shop
-- ============================================================
-- Usage:
--   mysql -u root -p < bssbms_full.sql
-- Or from MySQL:
--   SOURCE /path/to/bssbms_full.sql;
-- ============================================================

DROP DATABASE IF EXISTS bssbms;
CREATE DATABASE bssbms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bssbms;

-- -----------------------------------------------------------
-- ROLES
-- -----------------------------------------------------------
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (name, description) VALUES
('admin', 'Full system access'),
('manager', 'Manage inventory, purchases, reports, users'),
('cashier', 'POS sales and basic customer operations'),
('stock_keeper', 'Inventory and stock adjustments');

-- -----------------------------------------------------------
-- USERS
-- -----------------------------------------------------------
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

-- Password for all demo users: Admin@123
INSERT INTO users (role_id, full_name, username, email, phone, password_hash) VALUES
(1, 'System Administrator', 'admin', 'admin@bssbms.rw', '0780000001', '$2b$12$0ikwpUvSGNNDYedYY32hfeOqeNBLrliDmlJqYvpPHPJgldSaCDs/S'),
(2, 'Jean Claude Manager', 'manager', 'manager@bssbms.rw', '0780000002', '$2b$12$0ikwpUvSGNNDYedYY32hfeOqeNBLrliDmlJqYvpPHPJgldSaCDs/S'),
(3, 'Marie Cashier', 'cashier', 'cashier@bssbms.rw', '0780000003', '$2b$12$0ikwpUvSGNNDYedYY32hfeOqeNBLrliDmlJqYvpPHPJgldSaCDs/S');

-- -----------------------------------------------------------
-- BUSINESSES
-- -----------------------------------------------------------
CREATE TABLE businesses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  address TEXT,
  phone VARCHAR(20),
  email VARCHAR(120),
  tin VARCHAR(50),
  currency VARCHAR(5) DEFAULT 'RWF',
  logo_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO businesses (name, address, phone, email, tin) VALUES
('Kigali Corner Bar', 'KN 5 Ave, Kigali', '0788123456', 'info@kigalicorners.rw', '102345678');

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

INSERT INTO suppliers (name, contact_person, phone, address) VALUES
('BRALIRWA Ltd', 'Sales Desk', '0788300001', 'Kigali Industrial Park'),
('SKOL Brewery', 'Distributor', '0788300002', 'Kigali'),
('Inyange Industries', 'Sales', '0788300003', 'Kigali'),
('Local Soft Drinks Supplier', 'Patrick', '0788300004', 'Nyamirambo');

-- -----------------------------------------------------------
-- CATEGORIES
-- -----------------------------------------------------------
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO categories (name) VALUES
('Beer'),
('Soft Drinks'),
('Water'),
('Spirits'),
('Wine'),
('Juice'),
('Other');

-- -----------------------------------------------------------
-- UNITS
-- -----------------------------------------------------------
CREATE TABLE units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  abbreviation VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO units (name, abbreviation) VALUES
('Bottle', 'btl'),
('Crate', 'crt'),
('Pack', 'pk'),
('Piece', 'pc'),
('Liter', 'L'),
('Half-liter', '0.5L'),
('Can', 'can'),
('Case', 'case');

CREATE TABLE unit_conversions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_unit_id INT NOT NULL,
  to_unit_id INT NOT NULL,
  factor DECIMAL(12,4) NOT NULL,
  UNIQUE KEY unique_conversion (from_unit_id, to_unit_id),
  FOREIGN KEY (from_unit_id) REFERENCES units(id),
  FOREIGN KEY (to_unit_id) REFERENCES units(id)
);

-- 1 Crate = 24 Bottles (very common in Rwanda)
INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor)
SELECT f.id, t.id, 24 FROM units f, units t WHERE f.name = 'Crate' AND t.name = 'Bottle';

INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor)
SELECT f.id, t.id, 12 FROM units f, units t WHERE f.name = 'Case' AND t.name = 'Can';

INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor)
SELECT f.id, t.id, 6 FROM units f, units t WHERE f.name = 'Pack' AND t.name = 'Bottle';

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
  base_unit_id INT NOT NULL,
  purchase_unit_id INT,
  sale_unit_id INT,
  cost_price DECIMAL(12,2) DEFAULT 0,
  selling_price DECIMAL(12,2) DEFAULT 0,
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

-- Realistic Rwandan bar products (prices in RWF, approximate)
INSERT INTO products (category_id, name, sku, base_unit_id, purchase_unit_id, sale_unit_id, cost_price, selling_price, min_stock_level) VALUES
-- Beers
(1, 'Primus 65cl', 'PRM-65', 1, 2, 1, 800, 1200, 24),
(1, 'Mützig 65cl', 'MTZ-65', 1, 2, 1, 850, 1300, 24),
(1, 'Turbo King 65cl', 'TBK-65', 1, 2, 1, 900, 1400, 12),
(1, 'Amstel 33cl', 'AMS-33', 1, 2, 1, 700, 1100, 24),
(1, 'Heineken 33cl', 'HNK-33', 1, 2, 1, 1100, 1800, 12),
(1, 'Skol Lager 65cl', 'SKL-65', 1, 2, 1, 750, 1100, 24),
-- Soft drinks
(2, 'Coca-Cola 50cl', 'COC-50', 1, 2, 1, 400, 700, 24),
(2, 'Fanta Orange 50cl', 'FAN-50', 1, 2, 1, 400, 700, 24),
(2, 'Sprite 50cl', 'SPR-50', 1, 2, 1, 400, 700, 12),
(2, 'Vitalo 50cl', 'VIT-50', 1, 2, 1, 350, 600, 24),
-- Water
(3, 'Inyange Water 50cl', 'INY-50', 1, 3, 1, 200, 400, 48),
(3, 'Inyange Water 1.5L', 'INY-15', 1, 3, 1, 400, 800, 24),
-- Spirits (sold by bottle)
(4, 'Konyagi 75cl', 'KON-75', 1, 1, 1, 4500, 7000, 6),
(4, 'Waragi 75cl', 'WAR-75', 1, 1, 1, 4000, 6500, 6),
-- Juice
(6, 'Inyange Juice Mango 1L', 'IJM-1L', 1, 1, 1, 1200, 2000, 12);

-- -----------------------------------------------------------
-- STOCK
-- -----------------------------------------------------------
CREATE TABLE stock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL UNIQUE,
  quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  reserved_quantity DECIMAL(14,3) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Initial stock (in bottles / base unit)
INSERT INTO stock (product_id, quantity) VALUES
(1, 120),   -- Primus
(2, 96),    -- Mützig
(3, 48),    -- Turbo King
(4, 72),    -- Amstel
(5, 36),    -- Heineken
(6, 100),   -- Skol
(7, 80),    -- Coca-Cola
(8, 70),    -- Fanta
(9, 40),    -- Sprite
(10, 60),   -- Vitalo
(11, 150),  -- Water 50cl
(12, 40),   -- Water 1.5L
(13, 15),   -- Konyagi
(14, 12),   -- Waragi
(15, 25);   -- Juice

-- -----------------------------------------------------------
-- STOCK MOVEMENTS
-- -----------------------------------------------------------
CREATE TABLE stock_movements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  movement_type ENUM('purchase','sale','adjustment','return','transfer','waste') NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  reference_type VARCHAR(50),
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
  balance DECIMAL(14,2) DEFAULT 0,
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
  quantity DECIMAL(12,3) NOT NULL,
  unit_id INT NOT NULL,
  quantity_base DECIMAL(14,3) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL,
  total_cost DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
);

CREATE TABLE supplier_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  purchase_id BIGINT,
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

-- Sample purchase (5 crates Primus + 4 crates Mützig)
INSERT INTO purchases (supplier_id, invoice_number, purchase_date, status, subtotal, total_amount, amount_paid, balance, payment_status, created_by)
VALUES (1, 'BRAL-2026-001', CURDATE() - INTERVAL 3 DAY, 'received', 153600, 153600, 100000, 53600, 'partial', 1);

INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_id, quantity_base, unit_cost, total_cost) VALUES
(1, 1, 5, 2, 120, 19200, 96000),   -- 5 crates Primus @ 19200/crate
(1, 2, 4, 2, 96, 14400, 57600);    -- 4 crates Mützig

-- -----------------------------------------------------------
-- CUSTOMERS
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

INSERT INTO customers (name, phone, credit_limit, notes) VALUES
('Eric Habimana', '0788111222', 50000, 'Regular customer'),
('Alice Uwase', '0788333444', 30000, NULL),
('Hotel des Mille Collines', '0788555666', 200000, 'Corporate account'),
('Walk-in / Cash', NULL, 0, 'Default for cash sales');

CREATE TABLE customer_debts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  sale_id BIGINT,
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
-- SALES
-- -----------------------------------------------------------
CREATE TABLE sales (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  receipt_number VARCHAR(30) NOT NULL UNIQUE,
  customer_id INT,
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
  quantity_base DECIMAL(14,3) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) DEFAULT 0,
  total_price DECIMAL(14,2) NOT NULL,
  cost_at_sale DECIMAL(12,2),
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

-- Sample sales (today and yesterday)
INSERT INTO sales (receipt_number, customer_id, sale_date, status, subtotal, total_amount, amount_paid, change_given, payment_method, payment_status, created_by) VALUES
('BSS-20261103-0001', NULL, CURDATE() - INTERVAL 1 DAY + INTERVAL 14 HOUR, 'completed', 4800, 4800, 5000, 200, 'cash', 'paid', 3),
('BSS-20261103-0002', 1, CURDATE() - INTERVAL 1 DAY + INTERVAL 18 HOUR, 'completed', 7200, 7200, 0, 0, 'credit', 'credit', 3),
('BSS-20261104-0001', NULL, CURDATE() + INTERVAL 10 HOUR, 'completed', 3500, 3500, 3500, 0, 'mobile_money', 'paid', 3),
('BSS-20261104-0002', NULL, CURDATE() + INTERVAL 11 HOUR, 'completed', 2400, 2400, 2500, 100, 'cash', 'paid', 3);

INSERT INTO sale_items (sale_id, product_id, quantity, unit_id, quantity_base, unit_price, total_price, cost_at_sale) VALUES
(1, 1, 2, 1, 2, 1200, 2400, 800),
(1, 7, 2, 1, 2, 700, 1400, 400),
(1, 11, 2, 1, 2, 400, 800, 200),
(2, 2, 3, 1, 3, 1300, 3900, 850),
(2, 5, 1, 1, 1, 1800, 1800, 1100),
(2, 13, 1, 1, 1, 1500, 1500, 4500),  -- half measure approx
(3, 1, 1, 1, 1, 1200, 1200, 800),
(3, 8, 2, 1, 2, 700, 1400, 400),
(3, 11, 2, 1, 2, 400, 800, 200),
(4, 6, 2, 1, 2, 1100, 2200, 750),
(4, 10, 1, 1, 1, 600, 600, 350);

INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES
(1, 'cash', 5000),
(2, 'credit', 0),
(3, 'mobile_money', 3500),
(4, 'cash', 2500);

-- Debt for credit sale
INSERT INTO customer_debts (customer_id, sale_id, original_amount, remaining_amount, status)
VALUES (1, 2, 7200, 7200, 'open');

-- Adjust stock for the sample sales (subtract sold quantities)
UPDATE stock SET quantity = quantity - 3 WHERE product_id = 1;  -- Primus sold 2+1
UPDATE stock SET quantity = quantity - 3 WHERE product_id = 2;  -- Mützig
UPDATE stock SET quantity = quantity - 1 WHERE product_id = 5;  -- Heineken
UPDATE stock SET quantity = quantity - 2 WHERE product_id = 6;  -- Skol
UPDATE stock SET quantity = quantity - 2 WHERE product_id = 7;  -- Coke
UPDATE stock SET quantity = quantity - 2 WHERE product_id = 8;  -- Fanta
UPDATE stock SET quantity = quantity - 1 WHERE product_id = 10; -- Vitalo
UPDATE stock SET quantity = quantity - 4 WHERE product_id = 11; -- Water
UPDATE stock SET quantity = quantity - 1 WHERE product_id = 13; -- Konyagi

-- -----------------------------------------------------------
-- EXPENSES
-- -----------------------------------------------------------
CREATE TABLE expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO expense_categories (name) VALUES
('Rent'),
('Utilities'),
('Salaries'),
('Transport'),
('Maintenance'),
('Marketing'),
('Miscellaneous');

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

INSERT INTO expenses (category_id, title, amount, expense_date, payment_method, created_by) VALUES
(1, 'Shop rent - November', 150000, CURDATE() - INTERVAL 5 DAY, 'bank', 1),
(2, 'Electricity bill', 45000, CURDATE() - INTERVAL 2 DAY, 'mobile_money', 2),
(3, 'Cashier salary advance', 30000, CURDATE() - INTERVAL 1 DAY, 'cash', 1),
(4, 'Transport for stock', 15000, CURDATE(), 'cash', 2);

-- -----------------------------------------------------------
-- CASH MANAGEMENT
-- -----------------------------------------------------------
CREATE TABLE cash_registers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cash_registers (name) VALUES ('Main Counter');

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
  amount DECIMAL(14,2) NOT NULL,
  reference_type VARCHAR(50),
  reference_id BIGINT,
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES cash_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- -----------------------------------------------------------
-- AUDIT LOG
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
-- DONE
-- -----------------------------------------------------------
SELECT 'BSSBMS database created successfully!' AS message;
SELECT 'Login: admin / Admin@123' AS credentials;
SELECT COUNT(*) AS products FROM products;
SELECT COUNT(*) AS customers FROM customers;
SELECT COUNT(*) AS sample_sales FROM sales;
