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
      // https://xmpp.org/rfcs/rfc6121.html#roster-add-errors
      if (req.to !== xmpp.JID(req.attrs.from).bare().toString()) {
        return next(new StanzaError(
          'not allowed to access roster',
          'auth',
          'forbidden'
        ))
      }
      items = query.getChildren('item')
      if (req.attrs.type === 'get') {
        if (items.length > 0) {
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
                // FIXME!
                ver: new Date().toISOString()
              })

              for (item of items) {
                const el = query.c('item', { jid: item.jid })
                if (item.name) el.attrs.name = item.name
              }
              // TODO
              // 2.1.2.1.  Approved Attribute
              // 2.1.2.2.  Ask Attribute
              // 2.1.2.5.  Subscription Attribute
              // 2.1.2.6.  Group Element
              res.send()
            }
          })
        } catch (err) {
          next(err)
        }
      }
      if (req.attrs.type === 'set') {
        // https://xmpp.org/rfcs/rfc6121.html#roster-add-errors
        if (items.length !== 1) {
          return next(new StanzaError(
            'roster-set can contain one item only',
            'modify',
            'bad-request'
          ))
        }
        if (!(item = items[0]).attrs.jid) {
          return next(new StanzaError(
            'roster-set requires jid for item`',
            'modify',
            'bad-request'
          ))
        }
        try {
          const cb = err => {
            if (err) next(err)
            else res.send()
          }
          const key = { User: req.to, jid: item.attrs.jid }
          if (item.attrs.subscription === 'remove') {
            Roster.delete(key, cb)
          } else {
            Roster.update(key, { name: item.attrs.name }, cb)
          }
          // TODO
          // 2.1.2.6.  Group Element
          // FIXME 2.1.6.  Roster Push
          // If a connected resource or available resource requests the roster, it is referred to as an "interested resource". The server MUST send roster pushes to all interested resources.
        } catch (err) {
          next(err)
        }
      }
    } else {
      next()
    }
  }
}
