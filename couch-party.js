var PouchDB = require('pouchdb'), 
    HTTPPouchDB = require('http-pouchdb')(PouchDB, 'http://admin:admin@localhost:5984'), 
    _pouch = require('../under-pouch'), 
    _ = require('underscore')

var couchParty = {}

couchParty.login = function(baseName, login, callback) {
  //Find the id which corresponds to the nickname...
  var dbUsers = new HTTPPouchDB(baseName + '_users')
  //^ "_users" part appended automatically, 
  //so module user need only specify a base name; ie- a project name.
  _pouch.find(dbUsers, function(doc) { return doc.nickname == login.nickOrEmail || doc.email == login.nickOrEmail }, function(doc) {

    //Password check:
    if(login.password != doc.password) return callback('Incorrect password.')

    //Now connect to the corresponding (existing) database
    //which is based on the user's couch generated hash (but in lower case)
    dbUser = new HTTPPouchDB(baseName + '_user_' + doc._id.toLowerCase() )
    dbUser.get('user', function(err, userDoc) {
      if(err) return console.log(err)
      //Merge in the email and nickname from the previous doc: 
      userDoc = _.extend(doc, userDoc)
      callback(null, userDoc)
    })
  })
}

couchParty.register = function(baseName, email, callback) {
  //Creates a doc in the "baseName_users" database: 
  var dbCouch = new HTTPPouchDB(baseName + '_users')
  var doc = { verified: false, email: email }
  dbCouch.post(doc, function(err, res) {
    if(err) return console.log(err)
    console.log(res)
    //Now create a unique database for the user: 
    var userDbName = baseName + '_user_' +  doc._id.toLowerCase()
    dbUser = new HTTPPouchDB(userDbName)
    dbUser.post({ _id: 'user', db_name: userDbName }, function(err, res) {
      if(err) return console.log(err)
      console.log(res)
      callback() 
    })
  })
}

module.exports = couchParty
