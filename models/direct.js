var redis

function presenceKey (user) {
  return `presence:${user}`
}

const Direct = {
  all (user) {
    return new Promise((resolve, reject) => {
      redis.hgetall(presenceKey(user), (err, obj) => {
        if (err) return reject(err)
        resolve(obj)
      })
    })
  },
  one (user, jid) {
    return new Promise((resolve, reject) => {
      redis.hget(presenceKey(user), jid, (err, obj) => {
        if (err) return reject(err)
        resolve(obj)
      })
    })
  },
  set (user, jid) {
    return new Promise((resolve, reject) => {
      redis.hset(presenceKey(user), jid, true, (err, replies) => {
        if (err) return reject(err)
        resolve(replies)
      })
    })
  },
  del (user, jid) {
    return new Promise((resolve, reject) => {
      redis.hdel(presenceKey(user), jid, (err, replies) => {
        if (err) return reject(err)
        resolve(replies)
      })
    })
  },
  clear (user) {
    return new Promise((resolve, reject) => {
      redis.hkeys(presenceKey(user), (err, keys) => {
        if (err) return reject(err)
        if (keys.length > 0) {
          redis.hdel(presenceKey(user), keys, (err, replies) => {
            if (err) return reject(err)
            resolve(replies)
          })
        } else {
          resolve(0)
        }
      })
    })
  }
}

module.exports = Direct
module.exports.setStore = function (r) {
  redis = r
}
