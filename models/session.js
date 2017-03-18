var redis

function sessionKey (user) {
  return `session:${user}`
}

const Session = {
  all (user) {
    return new Promise((resolve, reject) => {
      redis.hgetall(sessionKey(user), (err, obj) => {
        if (err) return reject(err)
        resolve(obj)
      })
    })
  },
  one (user, resource) {
    return new Promise((resolve, reject) => {
      redis.hget(sessionKey(user), resource, (err, obj) => {
        if (err) return reject(err)
        resolve(obj)
      })
    })
  },
  first (user) {
    return new Promise((resolve, reject) => {
      reject(new Error('not-implemented'))
    })
  },
  set (user, resource, stanza) {
    return new Promise((resolve, reject) => {
      redis.hset(sessionKey(user), resource, stanza.toString(), (err, obj) => {
        if (err) return reject(err)
          // TODO create index by priority
        resolve(obj)
      })
    })
  },
  del (user, resource) {
    return new Promise((resolve, reject) => {
      redis.hdel(sessionKey(user), resource, (err, obj) => {
        if (err) return reject(err)
          // TODO update priority index
        resolve(obj)
      })
    })
  }
}

module.exports = Session
module.exports.setStore = function (r) {
  redis = r
}
