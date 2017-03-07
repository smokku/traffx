const dynamoose = require('dynamoose')
const xmpp = require('node-xmpp-core')

const rosterSchema = new dynamoose.Schema(
  {
    User: {
      type: String,
      validate: v => v === new xmpp.JID(v).bare().toString(),
      hashKey: true
    },
    jid: { type: String, rangeKey: true },
    name: { type: String },
    to: { type: Boolean },
    from: { type: Boolean },
    ask: { type: Number }
  },
  { throughput: 5 }
)

const Roster = dynamoose.model('Roster', rosterSchema)

module.exports = Roster
