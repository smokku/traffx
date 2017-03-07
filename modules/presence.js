const xmpp = require('node-xmpp-core')
const { StanzaError } = require('junction')

function shouldHandle (stanza) {
  return stanza.is('presence') &&
    [ 'subscribe', 'subscribed', 'unsubscribe', 'unsubscribed' ].includes(
      stanza.attrs.type
    )
}

function checkTo (stanza) {
  var to
  try {
    to = new xmpp.JID(stanza.attrs.to)
  } catch (err) {
    return new StanzaError(err.message, 'modify', 'jid-malformed')
  }
  stanza.attr('to', to.bare().toString())
  return null
}

/* https://xmpp.org/rfcs/rfc6121.html#sub
 * presence subscription
 */
module.exports = function (router) {
  return function presence (stanza, next) {
    if (shouldHandle(stanza)) {
      if (stanza.attrs.type === 'subscribe') {
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-inbound
        const err = checkTo(stanza)
        if (err) return next(err)

        // TODO
        // 2. If the contact exists and the user already has a subscription to the contact's presence

        // 3. if there is at least one available resource associated with the contact
        router.route(stanza.attrs.to, stanza)

        // TODO
        // 4. Otherwise, if the contact has no available resources when the subscription request
      }
    }
    next()
  }
}

module.exports.outbound = function (c2s) {
  return function presence (stanza, next) {
    if (shouldHandle(stanza)) {
      // https://xmpp.org/rfcs/rfc6120.html#stanzas-attributes-from-c2s
      var from = new xmpp.JID(stanza.attrs.from)
      stanza.attr('from', from.bare().toString())

      if (stanza.attrs.type === 'subscribe') {
        // https://xmpp.org/rfcs/rfc6121.html#sub-request-outbound
        const err = checkTo(stanza)
        if (err) return next(err)
      }
    }
    next()
  }
}
