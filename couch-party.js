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

    //If user does not exist:
    if(_.isUndefined(doc)) return callback('No user with that nickname or email.')

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

couchParty.register = function(baseName, login, callback) {
  var dbUsers = new HTTPPouchDB(baseName + '_users')

  //Check for existing user based on email address: 
  _pouch.find(dbUsers, function(doc) { return doc.email == login.email }, function(doc) {
    //If user exists:
    if(doc) {
      // console.log('A user with that nickname or email already exits.')
      // console.log(doc)
      return callback('A user with that email already exists.')
    } else {
      //Creates a doc in the "baseName_users" database:
      doc = login
      doc.verified = false
      dbUsers.post(doc, function(err, res) {
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
  })
}

couchParty.syncEverybody = function(baseName) {
  //### User database changes ###
  //Listen for changes to the user's databases.
  //(if password or email change happened in user's database,
  //this needs to be applied to master users db (baseName_users))
  var dbUsers = new HTTPPouchDB(baseName + '_users')
  _pouch.pluck(dbUsers, function(userDocs) {
    if(!_.isArray(userDocs)) userDocs = [userDocs]
    userDocs.forEach(function(userDoc) {
      //Create a new changes feed:
      var userDbName = baseName + '_user_' + userDoc._id.toLowerCase()
      var userDb = new HTTPPouchDB(userDbName)
      userDb.changes({live:true, include_docs: true, doc_ids: ['user']})
            .on('change', function(change) {
             console.log('Change to be applied for ' + userDoc.email)
              //Throw away the id and rev:
              delete change.doc._id
              delete change.doc._rev
              //Apply any relevant changes.
              var updatedDoc = _.chain(userDoc)
                                //Overwrite the existing userDoc:
                                .extend(change.doc)
                                //Only pick certain fields to avoid
                                //giving masters db more than it needs:
                                .pick('_id', '_rev', 'password', 'email', 'nickname', 'verified')
                                .value()
              //Put in the master users db:
              dbUsers.put(updatedDoc, function(err, res) {
                if(err) console.log(err)
                console.log(res)
                //Update the rev so this process works again next change:
                userDoc._rev = res.rev
              })
            })
            .on('error', function (err) {
              console.log(err)
            })
    })
  })
}

module.exports = couchParty
