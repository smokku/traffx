const { JID } = require('node-xmpp-core')

var redis

function sessionKey (jid) {
  return `session:${jid.bare().toString()}`
}

const Session = {
  all (user) {
    return new Promise((resolve, reject) => {
      redis.hgetall(sessionKey(new JID(user)), (err, obj) => {
        if (err) return reject(err)
        resolve(obj)
      })
    })
  },
  one (user, resource) {
    return new Promise((resolve, reject) => {
      reject(new Error('not-implemented'))
    })
  },
  first (user) {
    return new Promise((resolve, reject) => {
      reject(new Error('not-implemented'))
    })
  },
  set (stanza) {
    return new Promise((resolve, reject) => {
      if (!stanza.is('presence')) {
        reject(new Error('Session stores Presence only'))
      }
      const jid = new JID(stanza.from)
      if (!jid.resource) {
        reject(new Error('Session stores by resource'))
      }
      redis.hset(sessionKey(jid), jid.resource, stanza.toString(), (err, obj) => {
        if (err) return reject(err)
        // TODO create index by priority
        resolve(obj)
      })
    })
  },
  del (user, resource) {
    return new Promise((resolve, reject) => {
      reject(new Error('not-implemented'))
    })
  }
}

module.exports = Session
module.exports.setStore = function (r) {
  redis = r
}
