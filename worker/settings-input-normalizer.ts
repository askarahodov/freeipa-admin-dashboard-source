function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeSecretReplacement(body, valueKey, clearKey) {
  if (typeof body[valueKey] === "string" && !String(body[valueKey]).trim()) delete body[valueKey];
  if (body[clearKey] !== true) delete body[clearKey];
}

export function normalizeSettingsRequestBody(pathname, method, body) {
  if (method === "PUT" && pathname === "/api/integrations/settings") {
    const normalized = { ...body };
    normalizeSecretReplacement(normalized, "ipaPassword", "clearIpaPassword");
    normalizeSecretReplacement(normalized, "xyopsApiKey", "clearXyopsApiKey");
    return normalized;
  }

  if (method === "POST" && pathname === "/api/integrations/settings/drafts") {
    const nested = objectValue(body.changes);
    if (nested) {
      if (!Array.isArray(nested.resetFields) || nested.resetFields.length > 0) return body;
      const changes = { ...nested };
      delete changes.resetFields;
      return { ...body, changes };
    }
    if (!Array.isArray(body.resetFields) || body.resetFields.length > 0) return body;
    const normalized = { ...body };
    delete normalized.resetFields;
    return normalized;
  }

  return body;
}
