CREATE TABLE `product_units` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `product_id` INT NOT NULL,
  `unit_id` INT NOT NULL,
  `conversion_factor` DECIMAL(14,4) NOT NULL,
  `purchase_price` DECIMAL(14,2) NULL,
  `selling_price` DECIMAL(14,2) NULL,
  `is_purchase_enabled` TINYINT NOT NULL DEFAULT 0,
  `is_sale_enabled` TINYINT NOT NULL DEFAULT 0,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `is_default_purchase` TINYINT NOT NULL DEFAULT 0,
  `is_default_sale` TINYINT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `unique_product_unit` (`product_id`, `unit_id`),
  INDEX `idx_product_unit_active` (`product_id`, `is_active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sale_items`
  ADD COLUMN `product_name_snapshot` VARCHAR(150) NULL,
  ADD COLUMN `unit_name_snapshot` VARCHAR(50) NULL,
  ADD COLUMN `conversion_factor_snapshot` DECIMAL(14,4) NULL;

ALTER TABLE `purchase_items`
  ADD COLUMN `product_name_snapshot` VARCHAR(150) NULL,
  ADD COLUMN `unit_name_snapshot` VARCHAR(50) NULL,
  ADD COLUMN `conversion_factor_snapshot` DECIMAL(14,4) NULL;

INSERT INTO `product_units` (
  `product_id`, `unit_id`, `conversion_factor`, `purchase_price`, `selling_price`,
  `is_purchase_enabled`, `is_sale_enabled`, `is_active`,
  `is_default_purchase`, `is_default_sale`
)
SELECT
  p.`id`,
  p.`base_unit_id`,
  1,
  p.`cost_price`,
  CASE
    WHEN p.`sale_unit_id` IS NULL OR p.`sale_unit_id` = p.`base_unit_id` THEN p.`selling_price`
    ELSE p.`selling_price` / COALESCE(
      (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`sale_unit_id` AND uc.`to_unit_id` = p.`base_unit_id` LIMIT 1),
      1 / (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`base_unit_id` AND uc.`to_unit_id` = p.`sale_unit_id` LIMIT 1)
    )
  END,
  1, 1, 1,
  IF(p.`purchase_unit_id` = p.`base_unit_id`, 1, 0),
  IF(p.`sale_unit_id` = p.`base_unit_id`, 1, 0)
FROM `products` p;

INSERT INTO `product_units` (
  `product_id`, `unit_id`, `conversion_factor`, `purchase_price`, `selling_price`,
  `is_purchase_enabled`, `is_sale_enabled`, `is_active`,
  `is_default_purchase`, `is_default_sale`
)
SELECT
  p.`id`,
  p.`purchase_unit_id`,
  COALESCE(
    (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`purchase_unit_id` AND uc.`to_unit_id` = p.`base_unit_id` LIMIT 1),
    1 / (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`base_unit_id` AND uc.`to_unit_id` = p.`purchase_unit_id` LIMIT 1)
  ),
  p.`cost_price` * COALESCE(
    (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`purchase_unit_id` AND uc.`to_unit_id` = p.`base_unit_id` LIMIT 1),
    1 / (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`base_unit_id` AND uc.`to_unit_id` = p.`purchase_unit_id` LIMIT 1)
  ), NULL, 1, 0, 1, 1, 0
FROM `products` p
WHERE p.`purchase_unit_id` IS NOT NULL
  AND p.`purchase_unit_id` <> p.`base_unit_id`
  AND (
    EXISTS (SELECT 1 FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`purchase_unit_id` AND uc.`to_unit_id` = p.`base_unit_id`)
    OR EXISTS (SELECT 1 FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`base_unit_id` AND uc.`to_unit_id` = p.`purchase_unit_id`)
  )
ON DUPLICATE KEY UPDATE
  `purchase_price` = VALUES(`purchase_price`),
  `is_purchase_enabled` = 1,
  `is_default_purchase` = 1;

INSERT INTO `product_units` (
  `product_id`, `unit_id`, `conversion_factor`, `purchase_price`, `selling_price`,
  `is_purchase_enabled`, `is_sale_enabled`, `is_active`,
  `is_default_purchase`, `is_default_sale`
)
SELECT
  p.`id`,
  p.`sale_unit_id`,
  COALESCE(
    (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`sale_unit_id` AND uc.`to_unit_id` = p.`base_unit_id` LIMIT 1),
    1 / (SELECT uc.`factor` FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`base_unit_id` AND uc.`to_unit_id` = p.`sale_unit_id` LIMIT 1)
  ),
  NULL, p.`selling_price`, 0, 1, 1, 0, 1
FROM `products` p
WHERE p.`sale_unit_id` IS NOT NULL
  AND p.`sale_unit_id` <> p.`base_unit_id`
  AND (
    EXISTS (SELECT 1 FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`sale_unit_id` AND uc.`to_unit_id` = p.`base_unit_id`)
    OR EXISTS (SELECT 1 FROM `unit_conversions` uc WHERE uc.`from_unit_id` = p.`base_unit_id` AND uc.`to_unit_id` = p.`sale_unit_id`)
  )
ON DUPLICATE KEY UPDATE
  `selling_price` = VALUES(`selling_price`),
  `is_sale_enabled` = 1,
  `is_default_sale` = 1;

UPDATE `sale_items` si
JOIN `products` p ON p.`id` = si.`product_id`
LEFT JOIN `units` u ON u.`id` = si.`unit_id`
LEFT JOIN `unit_conversions` direct_conversion
  ON direct_conversion.`from_unit_id` = si.`unit_id` AND direct_conversion.`to_unit_id` = p.`base_unit_id`
LEFT JOIN `unit_conversions` inverse_conversion
  ON inverse_conversion.`from_unit_id` = p.`base_unit_id` AND inverse_conversion.`to_unit_id` = si.`unit_id`
SET
  si.`product_name_snapshot` = p.`name`,
  si.`unit_name_snapshot` = u.`name`,
  si.`conversion_factor_snapshot` = CASE
    WHEN si.`unit_id` = p.`base_unit_id` THEN 1
    WHEN direct_conversion.`factor` IS NOT NULL THEN direct_conversion.`factor`
    WHEN inverse_conversion.`factor` IS NOT NULL AND inverse_conversion.`factor` <> 0 THEN 1 / inverse_conversion.`factor`
    ELSE NULL
  END;

UPDATE `purchase_items` pi
JOIN `products` p ON p.`id` = pi.`product_id`
LEFT JOIN `units` u ON u.`id` = pi.`unit_id`
LEFT JOIN `unit_conversions` direct_conversion
  ON direct_conversion.`from_unit_id` = pi.`unit_id` AND direct_conversion.`to_unit_id` = p.`base_unit_id`
LEFT JOIN `unit_conversions` inverse_conversion
  ON inverse_conversion.`from_unit_id` = p.`base_unit_id` AND inverse_conversion.`to_unit_id` = pi.`unit_id`
SET
  pi.`product_name_snapshot` = p.`name`,
  pi.`unit_name_snapshot` = u.`name`,
  pi.`conversion_factor_snapshot` = CASE
    WHEN pi.`unit_id` = p.`base_unit_id` THEN 1
    WHEN direct_conversion.`factor` IS NOT NULL THEN direct_conversion.`factor`
    WHEN inverse_conversion.`factor` IS NOT NULL AND inverse_conversion.`factor` <> 0 THEN 1 / inverse_conversion.`factor`
    ELSE NULL
  END;
