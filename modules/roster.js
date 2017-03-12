const { StanzaError } = require('junction')
const { JID, Stanza } = require('node-xmpp-core')
const Roster = require('../models/roster')
const { uniq } = require('../utils')

function rosterItem (query, item) {
  const el = query.c('item', { jid: item.jid })
  if (item.name) el.attrs.name = item.name
  // TODO
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

/* https://tools.ietf.org/html/rfc6121#section-2
 * roster get/set
 * TODO extend disco with jabber:iq:roster
 */
module.exports = function (router) {
  return function roster (req, res, next) {
    var query, items, item
    if (req.is('iq') && (query = req.getChild('query', 'jabber:iq:roster'))) {
      // https://xmpp.org/rfcs/rfc6121.html#roster-add-errors
      if (req.to !== new JID(req.from).bare().toString()) {
        return next(new StanzaError(
          'not allowed to access roster',
          'auth',
          'forbidden'
        ))
      }
      items = query.getChildren('item')
      if (req.type === 'get') {
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
                if (item.in) {
                  // 3.1.3.  Server Processing of Inbound Subscription Request
                  // then deliver the request when the contact next has an available resource.
                  // The contact's server MUST continue to deliver the subscription request whenever
                  // the contact creates an available resource, until the contact either approves or denies the request
                  // FIXME!!! re-generate presence subscription
                  router.log.error(
                    { client_jid: req.to, roster_jid: item.jid },
                    'Should rerequest presence subscription'
                  )
                } else {
                  if (item.ask) {
                    // 3.1.2.  Server Processing of Outbound Subscription Request
                    // server SHOULD resend the subscription request to the contact based on an implementation-specific algorithm
                    // FIXME!!! re-generate presence subscription request
                    router.log.error(
                      { client_jid: req.to, roster_jid: item.jid },
                      'Should resend presence subscription'
                    )
                  }
                  rosterItem(query, item)
                }
              }
              res.send()
            }
          })
        } catch (err) {
          next(err)
        }
      }
      if (req.type === 'set') {
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
            // FIXME should send presence-unsubscribed and presence-offline?
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

module.exports.rosterItem = rosterItem
module.exports.rosterPush = rosterPush
