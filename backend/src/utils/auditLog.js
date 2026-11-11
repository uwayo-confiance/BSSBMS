async function recordAuditEvent(tx, req, {
  action,
  entityType,
  entityId,
  reason = null,
  before = null,
  after = null,
}) {
  return tx.audit_logs.create({
    data: {
      user_id: req.user?.id || null,
      action,
      entity_type: entityType,
      entity_id: entityId == null ? null : BigInt(entityId),
      ip_address: req.ip || null,
      ...(before ? { old_values: before } : {}),
      ...(after ? { new_values: after } : {}),
      ...(reason ? { new_values: { ...(after || {}), reason } } : {}),
    },
  });
}

module.exports = { recordAuditEvent };
