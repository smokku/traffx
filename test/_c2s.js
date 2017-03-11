'use strict'
import ModC2S from '../c2s'

module.exports = function c2s (server, router) {
  return new Promise((resolve, reject) => {
    const c2s = new ModC2S({
      server,
      router,
      log: router.log,
      dumpExceptions: false
    })
    c2s.server.on('online', () => {
      resolve(c2s)
    })
  })
}
