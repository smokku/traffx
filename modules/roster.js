const { StanzaError } = require('junction')
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

/* https://tools.ietf.org/html/rfc6121#section-2
 * roster get/set
 * presence subscription
 * TODO extend disco with jabber:iq:roster
 */
module.exports = function (router) {
  return function roster (req, res, next) {
    var query, items, item
    if (req.is('iq') && (query = req.getChild('query', 'jabber:iq:roster'))) {
      items = query.getChildren('item')
      if (req.attrs.type === 'get') {
        if (items.length) {
          return next(new StanzaError(
            'roster-get cannot contain items',
            'modify',
            'bad-request'
          ))
        }
        try {
          Roster.query({ User: { eq: req.to } }, (err, items) => {
            if (err) next(err)
            else {
              query = res.c('query', {
                xmlns: 'jabber:iq:roster',
                ver: new Date().toISOString() // FIXME!
              })

              for (item of items) {
                query.c('item', { jid: item.jid, name: item.name })
              }

              res.send()
            }
          })
        } catch (e) {
          next(e)
        }
      }
      if (req.attrs.type === 'set') {
        try {
          let updates = items.map(item => {
            return new Promise((resolve, reject) => {
              Roster.update(
                { User: req.to, jid: item.attrs.jid },
                { name: item.attrs.name },
                err => {
                  if (err) reject(err)
                  else resolve()
                }
              )
            })
          })
          Promise.all(updates).catch(next).then(() => res.send())
          // FIXME implement push
        } catch (e) {
          next(e)
        }
      }
    } else {
      next()
    }
  }
}
