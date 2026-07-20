function buildMatchKey(...parts) {
  return parts.join('').replace(/[\s-]/g, '');
}

module.exports = { buildMatchKey };
