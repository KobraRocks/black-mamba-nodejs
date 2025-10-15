import '../env/index.js';

const cachedEmail = (() => {
  const raw = process.env.BM_SUPER_ADMIN;
  if (!raw) return null;
  const normalized = String(raw).trim().toLowerCase();
  return normalized.length ? normalized : null;
})();

export function getSuperAdminEmail() {
  return cachedEmail;
}

export function hasSuperAdmin() {
  return cachedEmail !== null;
}

export function isSuperAdmin(email) {
  if (!cachedEmail) return false;
  if (!email) return false;
  return String(email).trim().toLowerCase() === cachedEmail;
}

export default { getSuperAdminEmail, hasSuperAdmin, isSuperAdmin };
