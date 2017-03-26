const dynamoose = require('dynamoose')

const rosterSchema = new dynamoose.Schema(
  {
    User: { type: String, validate: require('./validate').user, hashKey: true },
    jid: { type: String, rangeKey: true },
    name: { type: String },
    to: { type: Boolean },
    from: { type: Boolean },
    ask: { type: String },
    in: { type: String },
    approved: { type: Boolean }
  },
  { throughput: 5 }
)

const roster = dynamoose.model('Roster', rosterSchema)

const Roster = {
  all (user) {
    const query = { User: { eq: user } }
    return new Promise((resolve, reject) => {
      roster.query(query, (err, items) => {
        if (err) return reject(err)
        resolve(items)
      })
    })
  },
  one (user, jid) {
    const query = { User: { eq: user }, jid: { eq: jid } }
    return new Promise((resolve, reject) => {
      roster.query(query, (err, items) => {
        if (err) return reject(err)
        resolve(items[0])
      })
    })
  },
  set (user, jid, attrs) {
    const key = { User: user, jid }
    return new Promise((resolve, reject) => {
      roster.update(key, attrs, (err, item) => {
        if (err) return reject(err)
        resolve(item)
      })
    })
  },
  del (user, jid) {
    const key = { User: user, jid }
    return new Promise((resolve, reject) => {
      roster.delete(key, (err, item) => {
        if (err) return reject(err)
        resolve(item)
      })
    })
  }
}

module.exports = Roster
