'use strict'
import bunyan from 'bunyan'
module.exports = function log (name) {
  return bunyan.createLogger({ name, level: bunyan.FATAL + 1 })
}
