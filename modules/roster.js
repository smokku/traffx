const { StanzaError } = require('junction')
const { JID, Stanza } = require('node-xmpp-core')
const Roster = require('../models/roster')
const { uniq } = require('../utils')

function rosterItem (query, item) {
  const el = query.c('item', { jid: item.jid })
  if (item.name) el.attrs.name = item.name
  // 2.1.2.1.  Approved Attribute
  if (item.approved) el.attrs.approved = 'true'
  // 2.1.2.2.  Ask Attribute
  if (item.ask) el.attrs.ask = 'subscribe'
  // 2.1.2.5.  Subscription Attribute
  if (item.from && item.to) {
    el.attrs.subscription = 'both'
  } else if (item.from) {
    el.attrs.subscription = 'from'
  } else if (item.to) {
    el.attrs.subscription = 'to'
  }
  // 2.1.2.6.  Group Element
  return el
}

function rosterPush (to, item) {
  const query = new Stanza('iq', {
    to,
    from: to,
    type: 'set',
    id: uniq(12)
  }).c('query', { xmlns: 'jabber:iq:roster' })
  rosterItem(query, item)
  return query.root()
}

function isDummy (item) {
  return item.in &&
    typeof item.to === 'undefined' &&
    typeof item.from === 'undefined'
}

/* https://tools.ietf.org/html/rfc6121#section-2
 * roster get/set
 * TODO: extend disco with jabber:iq:roster
 */
module.exports = function (router) {
  return function roster (req, res, next) {
    var query, items, item
    if (req.is('iq') && (query = req.getChild('query', 'jabber:iq:roster'))) {
      // https://xmpp.org/rfcs/rfc6121.html#roster-add-errors
      if (req.to !== new JID(req.from).bare().toString()) {
        return next(
          new StanzaError('not allowed to access roster', 'auth', 'forbidden')
        )
      }
      items = query.getChildren('item')
      if (req.type === 'get') {
        if (items.length > 0) {
          return next(
            new StanzaError(
              'roster-get cannot contain items',
              'modify',
              'bad-request'
            )
          )
        }
        Roster.all(req.to)
          .then(items => {
            query = res.c('query', {
              xmlns: 'jabber:iq:roster',
              // FIXME: really implement versioning
              ver: new Date().toISOString()
            })

            for (item of items) {
              // skip items existing only to store 'Pending In'
              if (isDummy(item)) continue
              rosterItem(query, item)
            }
            res.send()
          })
          .catch(next)
      }
      if (req.type === 'set') {
        // https://xmpp.org/rfcs/rfc6121.html#roster-add-errors
        if (items.length !== 1) {
          return next(
            new StanzaError(
              'roster-set can contain one item only',
              'modify',
              'bad-request'
            )
          )
        }
        if (!(item = items[0]).attrs.jid) {
          return next(
            new StanzaError(
              'roster-set requires jid for item`',
              'modify',
              'bad-request'
            )
          )
        }
        if (item.attrs.subscription === 'remove') {
          Roster.del(req.to, item.attrs.jid).then(() => res.send()).catch(next)
          // FIXME: should send presence-unsubscribed and presence-offline?
        } else {
          Roster.set(req.to, item.attrs.jid, { name: item.attrs.name })
            .then(() => res.send())
            .catch(next)
        }
        // TODO: 2.1.2.6.  Group Element
        // FIXME: 2.1.6.  Roster Push
        // If a connected resource or available resource requests the roster,
        // it is referred to as an "interested resource". The server MUST send
        // roster pushes to all interested resources.
      }
    } else {
      next()
    }
  }
}

module.exports.rosterItem = rosterItem
module.exports.rosterPush = rosterPush
module.exports.isDummy = isDummy
