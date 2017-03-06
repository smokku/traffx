module.exports = function logger (options = {}) {
  var prefix = options.prefix || ''
  var logger = options.logger || process.stdout

  return function dump (stanza, next) {
    logger(prefix + stanza)
    next()
  }
}
