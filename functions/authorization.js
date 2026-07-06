"use strict";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function memberHasExplicitAccess(member = {}) {
  return member.role === "owner" || (
    member.role === "member" &&
    isRecord(member.permissions)
  );
}

function memberPermission(member = {}, key = "") {
  if (!memberHasExplicitAccess(member)) return {};
  const permission = member.permissions?.[key];
  return isRecord(permission) ? permission : {};
}

function memberCanManageRequests(member = {}) {
  return member.role === "owner" ||
    memberPermission(member, "requests").edit === true ||
    memberPermission(member, "turnos").edit === true;
}

function memberCanReadWorkerCalendar(member = {}) {
  if (member.role === "owner") return true;

  return ["turnos", "profile", "requests"].some(key => {
    const permission = memberPermission(member, key);
    return permission.view === true || permission.edit === true;
  });
}

module.exports = {
  memberCanManageRequests,
  memberCanReadWorkerCalendar,
  memberHasExplicitAccess
};
