'use strict'
import Router from '../modules/router'

const dynalite = require('dynalite')()
const dynaPort = 11000 + process.pid

module.exports = function (name) {
  return new Promise((resolve, reject) => {
    dynalite.listen(dynaPort, err => {
      if (err) return reject(err)
      const router = new Router({
        db: 1,
        prefix: name,
        dynamo: 'http://localhost:' + dynaPort,
        dumpExceptions: false,
        log: require('./_log')(name),
        router: {
          send (stanza) {
            // wrap all outgoing packets back
            router.process(stanza, true)
          }
        }
      })
      resolve(router)
    })
  })
}
