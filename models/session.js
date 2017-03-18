var redis

function sessionKey (user) {
  return `session:${user}`
}

function priorityKey (user) {
  return `session.priority:${user}`
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
  top (user) {
    return new Promise((resolve, reject) => {
      redis.zrevrangebyscore(priorityKey(user), '+inf', '-inf', 'LIMIT', 0, 1, (
        err,
        obj
      ) => {
        if (err) return reject(err)
        resolve(obj[0])
      })
    })
  },
  set (user, resource, priority, stanza) {
    return new Promise((resolve, reject) => {
      redis
        .multi()
        .hset(sessionKey(user), resource, stanza.toString())
        .zadd(priorityKey(user), priority, resource)
        .exec((err, replies) => {
          if (err) return reject(err)
          resolve(replies)
        })
    })
  },
  del (user, resource) {
    return new Promise((resolve, reject) => {
      redis
        .multi()
        .hdel(sessionKey(user), resource)
        .zrem(priorityKey(user), resource)
        .exec((err, replies) => {
          if (err) return reject(err)
          resolve(replies)
        })
    })
  }
}

module.exports = Session
module.exports.setStore = function (r) {
  redis = r
}
