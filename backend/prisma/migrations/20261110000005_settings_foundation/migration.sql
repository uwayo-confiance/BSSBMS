ALTER TABLE `businesses`
  ADD COLUMN `timezone` VARCHAR(60) NOT NULL DEFAULT 'Africa/Kigali',
  ADD COLUMN `receipt_footer` VARCHAR(255) NULL;

ALTER TABLE `bar_areas`
  ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0;

ALTER TABLE `dining_tables`
  ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0,
  ADD COLUMN `display_x` INT NULL,
  ADD COLUMN `display_y` INT NULL;

CREATE TABLE `system_settings` (
  `key` VARCHAR(80) NOT NULL,
  `value` JSON NOT NULL,
  `updated_by` INT NULL,
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_unit_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` INT NOT NULL,
  `unit_id` INT NOT NULL,
  `old_values` JSON NULL,
  `new_values` JSON NOT NULL,
  `reason` TEXT NOT NULL,
  `changed_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_product_unit_history_date` (`product_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
