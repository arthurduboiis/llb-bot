const config = require('../config');

function isOfficer(member) {
  if (!config.OFFICER_ROLE_ID) return member.permissions.has('Administrator');
  return member.roles.cache.has(config.OFFICER_ROLE_ID) || member.permissions.has('Administrator');
}

function isLeaderOrOfficer(member, session) {
  return member.id === session.leader_id || isOfficer(member);
}

module.exports = { isOfficer, isLeaderOrOfficer };
