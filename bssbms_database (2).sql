-- ============================================================
-- BSSBMS: Bar Stock, Sales and Business Management System
-- MySQL 8.0+ | InnoDB | utf8mb4
--
-- Import:
--   mysql -u root -p < bssbms_database.sql
-- Or import this file using phpMyAdmin / MySQL Workbench.
--
-- IMPORTANT:
-- 1. This file creates the database, tables, indexes and lookup data.
-- 2. It does NOT create a default administrator account or password.
--    Create the first user through your backend's secure setup process.
-- 3. Perform stock and payment operations inside database transactions
--    in the Node/Express backend.
-- ============================================================

CREATE DATABASE IF NOT EXISTS bssbms
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE bssbms;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS cash_movements;
DROP TABLE IF EXISTS cash_sessions;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS expense_categories;
DROP TABLE IF EXISTS sale_payments;
DROP TABLE IF EXISTS sale_items;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS purchase_payments;
DROP TABLE IF EXISTS purchase_items;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS stock_balances;
DROP TABLE IF EXISTS product_unit_conversions;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS business_locations;
DROP TABLE IF EXISTS businesses;

SET FOREIGN_KEY_CHECKS = 1;

-- 1. Businesses and locations (supports multiple businesses/branches)
CREATE TABLE businesses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  business_type ENUM('bar','beverage_shop','other') NOT NULL DEFAULT 'bar',
  phone VARCHAR(30),
  email VARCHAR(160),
  tin VARCHAR(40),
  address VARCHAR(255),
  country VARCHAR(80) NOT NULL DEFAULT 'Rwanda',
  currency CHAR(3) NOT NULL DEFAULT 'RWF',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_business_tin (tin)
) ENGINE=InnoDB;

CREATE TABLE business_locations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(30),
  address VARCHAR(255),
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_location_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  UNIQUE KEY uq_location_name (business_id, name),
  KEY idx_location_business (business_id)
) ENGINE=InnoDB;

-- 2. Roles and users
CREATE TABLE roles (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  description VARCHAR(180),
  UNIQUE KEY uq_role_name (name)
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NULL,
  role_id SMALLINT UNSIGNED NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(160) NOT NULL,
  phone VARCHAR(30),
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_user_location FOREIGN KEY (location_id) REFERENCES business_locations(id),
  CONSTRAINT fk_user_role FOREIGN KEY (role_id) REFERENCES roles(id),
  UNIQUE KEY uq_user_email_per_business (business_id, email),
  KEY idx_user_location (location_id),
  KEY idx_user_role (role_id)
) ENGINE=InnoDB;

-- 3. Customers, suppliers and product setup
CREATE TABLE customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(160),
  address VARCHAR(255),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  KEY idx_customer_business_name (business_id, full_name),
  KEY idx_customer_phone (business_id, phone)
) ENGINE=InnoDB;

CREATE TABLE suppliers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  contact_person VARCHAR(150),
  phone VARCHAR(30),
  email VARCHAR(160),
  address VARCHAR(255),
  tin VARCHAR(40),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_supplier_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  KEY idx_supplier_business_name (business_id, name),
  KEY idx_supplier_phone (business_id, phone)
) ENGINE=InnoDB;

CREATE TABLE categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_category_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  UNIQUE KEY uq_category_name (business_id, name)
) ENGINE=InnoDB;

CREATE TABLE units (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  abbreviation VARCHAR(20) NOT NULL,
  UNIQUE KEY uq_unit_name (name),
  UNIQUE KEY uq_unit_abbreviation (abbreviation)
) ENGINE=InnoDB;

CREATE TABLE products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  base_unit_id SMALLINT UNSIGNED NOT NULL,
  sku VARCHAR(80),
  barcode VARCHAR(100),
  name VARCHAR(160) NOT NULL,
  description TEXT,
  cost_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  selling_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  reorder_level DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_product_base_unit FOREIGN KEY (base_unit_id) REFERENCES units(id),
  UNIQUE KEY uq_product_sku (business_id, sku),
  UNIQUE KEY uq_product_barcode (business_id, barcode),
  KEY idx_product_name (business_id, name),
  KEY idx_product_category (category_id)
) ENGINE=InnoDB;

-- A conversion row means: 1 selected unit = base_quantity base units.
-- Example: if the base unit is bottle, 1 crate = 24 bottles.
CREATE TABLE product_unit_conversions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  unit_id SMALLINT UNSIGNED NOT NULL,
  base_quantity DECIMAL(14,3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_conversion_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_conversion_unit FOREIGN KEY (unit_id) REFERENCES units(id),
  UNIQUE KEY uq_product_conversion_unit (product_id, unit_id),
  CONSTRAINT chk_conversion_positive CHECK (base_quantity > 0)
) ENGINE=InnoDB;

-- 4. Stock balances and stock movement history
CREATE TABLE stock_balances (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity_base DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_balance_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_balance_location FOREIGN KEY (location_id) REFERENCES business_locations(id),
  CONSTRAINT fk_balance_product FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE KEY uq_stock_location_product (location_id, product_id),
  KEY idx_balance_business_product (business_id, product_id)
) ENGINE=InnoDB;

CREATE TABLE stock_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  movement_type ENUM('opening','purchase','sale','sale_return','purchase_return','adjustment','transfer_in','transfer_out') NOT NULL,
  source_type VARCHAR(40),
  source_id BIGINT UNSIGNED NULL,
  quantity_change_base DECIMAL(14,3) NOT NULL,
  unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  note VARCHAR(255),
  idempotency_key VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movement_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_movement_location FOREIGN KEY (location_id) REFERENCES business_locations(id),
  CONSTRAINT fk_movement_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_movement_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_movement_idempotency (business_id, idempotency_key),
  KEY idx_movement_product_date (product_id, created_at),
  KEY idx_movement_source (source_type, source_id),
  KEY idx_movement_location_date (location_id, created_at)
) ENGINE=InnoDB;

-- 5. Purchases and supplier payments
CREATE TABLE purchases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  invoice_number VARCHAR(100),
  purchase_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('draft','received','cancelled') NOT NULL DEFAULT 'draft',
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  balance_due DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_purchase_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_purchase_location FOREIGN KEY (location_id) REFERENCES business_locations(id),
  CONSTRAINT fk_purchase_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_purchase_user FOREIGN KEY (recorded_by) REFERENCES users(id),
  UNIQUE KEY uq_purchase_invoice (business_id, invoice_number),
  KEY idx_purchase_date (business_id, purchase_date),
  KEY idx_purchase_supplier (supplier_id)
) ENGINE=InnoDB;

CREATE TABLE purchase_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  unit_id SMALLINT UNSIGNED NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  conversion_factor DECIMAL(14,3) NOT NULL,
  quantity_base DECIMAL(14,3) NOT NULL,
  unit_cost DECIMAL(14,2) NOT NULL,
  line_total DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_purchase_item_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_purchase_item_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_purchase_item_unit FOREIGN KEY (unit_id) REFERENCES units(id),
  KEY idx_purchase_item_product (product_id),
  CONSTRAINT chk_purchase_item_quantity CHECK (quantity > 0 AND conversion_factor > 0)
) ENGINE=InnoDB;

CREATE TABLE purchase_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_id BIGINT UNSIGNED NOT NULL,
  received_by BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_method ENUM('cash','mobile_money','bank','card','other') NOT NULL DEFAULT 'cash',
  reference_number VARCHAR(120),
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note VARCHAR(255),
  CONSTRAINT fk_purchase_payment_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_purchase_payment_user FOREIGN KEY (received_by) REFERENCES users(id),
  KEY idx_purchase_payment_date (purchase_id, paid_at),
  CONSTRAINT chk_purchase_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB;

-- 6. Sales, sale items and customer payments
CREATE TABLE sales (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  cashier_id BIGINT UNSIGNED NOT NULL,
  receipt_number VARCHAR(100) NOT NULL,
  sale_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('draft','completed','voided','refunded') NOT NULL DEFAULT 'completed',
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  balance_due DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_sale_location FOREIGN KEY (location_id) REFERENCES business_locations(id),
  CONSTRAINT fk_sale_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_sale_cashier FOREIGN KEY (cashier_id) REFERENCES users(id),
  UNIQUE KEY uq_sale_receipt (business_id, receipt_number),
  KEY idx_sale_date (business_id, sale_date),
  KEY idx_sale_customer (customer_id),
  KEY idx_sale_status (business_id, status)
) ENGINE=InnoDB;

CREATE TABLE sale_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  unit_id SMALLINT UNSIGNED NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  conversion_factor DECIMAL(14,3) NOT NULL,
  quantity_base DECIMAL(14,3) NOT NULL,
  unit_price DECIMAL(14,2) NOT NULL,
  unit_cost_snapshot DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_sale_item_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_sale_item_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_sale_item_unit FOREIGN KEY (unit_id) REFERENCES units(id),
  KEY idx_sale_item_product (product_id),
  CONSTRAINT chk_sale_item_quantity CHECK (quantity > 0 AND conversion_factor > 0)
) ENGINE=InnoDB;

CREATE TABLE sale_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  received_by BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_method ENUM('cash','mobile_money','bank','card','other') NOT NULL DEFAULT 'cash',
  reference_number VARCHAR(120),
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note VARCHAR(255),
  CONSTRAINT fk_sale_payment_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_sale_payment_user FOREIGN KEY (received_by) REFERENCES users(id),
  KEY idx_sale_payment_date (sale_id, paid_at),
  CONSTRAINT chk_sale_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB;

-- 7. Expenses and cash control
CREATE TABLE expense_categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_category_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  UNIQUE KEY uq_expense_category (business_id, name)
) ENGINE=InnoDB;

CREATE TABLE expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  amount DECIMAL(14,2) NOT NULL,
  payment_method ENUM('cash','mobile_money','bank','card','other') NOT NULL DEFAULT 'cash',
  reference_number VARCHAR(120),
  expense_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_expense_location FOREIGN KEY (location_id) REFERENCES business_locations(id),
  CONSTRAINT fk_expense_category FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT fk_expense_user FOREIGN KEY (recorded_by) REFERENCES users(id),
  KEY idx_expense_date (business_id, expense_date),
  CONSTRAINT chk_expense_amount CHECK (amount > 0)
) ENGINE=InnoDB;

CREATE TABLE cash_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  opened_by BIGINT UNSIGNED NOT NULL,
  closed_by BIGINT UNSIGNED NULL,
  opening_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  expected_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  counted_amount DECIMAL(14,2) NULL,
  difference_amount DECIMAL(14,2) NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  notes VARCHAR(255),
  CONSTRAINT fk_cash_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_cash_location FOREIGN KEY (location_id) REFERENCES business_locations(id),
  CONSTRAINT fk_cash_open_user FOREIGN KEY (opened_by) REFERENCES users(id),
  CONSTRAINT fk_cash_close_user FOREIGN KEY (closed_by) REFERENCES users(id),
  KEY idx_cash_location_status (location_id, status, opened_at)
) ENGINE=InnoDB;

CREATE TABLE cash_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cash_session_id BIGINT UNSIGNED NOT NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  movement_type ENUM('cash_in','cash_out','sale','expense','supplier_payment','other') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reference_type VARCHAR(40),
  reference_id BIGINT UNSIGNED NULL,
  description VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cash_movement_session FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id),
  CONSTRAINT fk_cash_movement_user FOREIGN KEY (recorded_by) REFERENCES users(id),
  KEY idx_cash_movement_session_date (cash_session_id, created_at),
  CONSTRAINT chk_cash_movement_amount CHECK (amount > 0)
) ENGINE=InnoDB;

-- 8. Audit trail
CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  KEY idx_audit_business_date (business_id, created_at),
  KEY idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;

-- 9. Starter lookup data
INSERT INTO roles (name, description) VALUES
('admin', 'Full access to business settings and all modules'),
('manager', 'Manage daily operations, stock, purchases, sales and reports'),
('cashier', 'Process sales and receive customer payments'),
('storekeeper', 'Manage products, purchases and stock operations');

INSERT INTO units (name, abbreviation) VALUES
('Bottle', 'btl'),
('Crate', 'crate'),
('Pack', 'pack'),
('Can', 'can'),
('Carton', 'ctn'),
('Piece', 'pc'),
('Litre', 'L'),
('Millilitre', 'ml'),
('Kilogram', 'kg'),
('Gram', 'g');

-- Create business-specific categories and expense categories after
-- registering a business. Product-specific unit conversions should also
-- be inserted after products are created.

-- Useful first setup sequence:
-- 1. INSERT INTO businesses (name, business_type, phone, address)
--    VALUES ('My Bar', 'bar', '+250...', 'Huye, Rwanda');
-- 2. INSERT INTO business_locations (business_id, name, is_main)
--    VALUES (1, 'Main Branch', TRUE);
-- 3. Create the first user with a bcrypt password hash from your backend.
-- 4. Create categories, products, stock balances and unit conversions.
--
-- Example conversion for a product whose base unit is Bottle:
-- INSERT INTO product_unit_conversions (product_id, unit_id, base_quantity)
-- VALUES (1, 1, 1), (1, 2, 24);
-- (Assumes unit IDs 1=Bottle and 2=Crate in this fresh database.)
--
-- IMPORTANT BUSINESS LOGIC:
-- - Store all stock quantities in the product's base unit.
-- - On purchase receipt: add quantity_base to stock_balances and write
--   a positive stock_movements row.
-- - On completed sale: subtract quantity_base and write a negative
--   stock_movements row.
-- - Lock the stock_balances row (SELECT ... FOR UPDATE) during checkout.
-- - Update sale/purchase totals and payment balances from payment records.
-- - Use one SQL transaction for each purchase receipt, sale, return,
--   payment and cash reconciliation. Roll back on any failure.
-- - Validate business_id and location_id on the server for every request.
-- - Never store plain-text passwords; hash with bcrypt.
