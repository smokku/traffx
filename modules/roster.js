const StanzaError = require('junction').StanzaError

/* https://tools.ietf.org/html/rfc6121#section-2
 * roster get/set
 * presence subscription
 * TODO extend disco with jabber:iq:roster
 */
module.exports = function () {
  return function roster (req, res, next) {
    var query
    if (req.is('iq') && (query = req.getChild('query', 'jabber:iq:roster'))) {
      if (req.attrs.type === 'get') {
        let items = query.getChildren('item')
        if (items.length) {
          return next(new StanzaError(
            'roster-get cannot contain items',
            'modify',
            'bad-request'
          ))
        }
        res.send()
      }
      if (req.attrs.type === 'set') {
      }
    } else {
      next()
    }
  }
}
