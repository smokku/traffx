const dynamoose = require('dynamoose')

const lastSchema = new dynamoose.Schema(
  {
    User: { type: String, validate: require('./validate').user, hashKey: true },
    presence: { type: String },
    date: { type: Date }
  },
  { throughput: 5 }
)

const last = dynamoose.model('Last', lastSchema)

const Roster = {
  get (user) {
    const query = { User: { eq: user } }
    return new Promise((resolve, reject) => {
      last.query(query, (err, items) => {
        if (err) return reject(err)
        resolve(items[0])
      })
    })
  },
  set (user, stanza, date) {
    const key = { User: user }
    return new Promise((resolve, reject) => {
      last.update(key, { presence: stanza.toString(), date }, (err, item) => {
        if (err) return reject(err)
        resolve(item)
      })
    })
  },
  del (user) {
    const key = { User: user }
    return new Promise((resolve, reject) => {
      last.delete(key, (err, item) => {
        if (err) return reject(err)
        resolve(item)
      })
    })
  }
}

module.exports = Roster
