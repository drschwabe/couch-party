##  Couch Party

ALPHA / WIP

A set of functions for building Couch/PouchDB driven multi-user apps.   Currently does basic login, registration, and user profile syncing. 

```
npm install couch-party
```


### Party time

```
//Login
var baseCouchURL = 'http://admin:admin@localhost:5984/myProject'
var login = {
    nickOrEmail: "Sarah", 
    password: 'w00t'
}
couchParty.login(baseCouchURL, login, function(err, doc) {
    if(err) console.log('You were not invited!')
    else console.log('Welcome to the party yo!')
})
```

```
//Register
var form = {
    nickname: 'Sarah', 
    email : 'sara@geemail.com', 
    password : 'w00t'
}
couchParty.register(baseCouchURL, form, function(err, couchRes) {
    if(err) console.log(err)
    else console.log('User created with doc._id of: ' couchRes.id)
})
```



### Sync time

There is also a function to sync client-side changes with help from PouchDB: 

```
//server.js
couchParty.syncEverybody(baseCouchURL)
```

Each user gets their own database.  In addition, a single 'mother' database is used for authentication.  syncEverybody function keeps changes from the individual user databases to the mother.  

On client side, now you can just save stuff to a browser PouchDB and let it's sync feature take care of the rest. 

```
//app.js (browser)
//First, get the user doc by logging in: 
var userDoc
$.post('http://localhost:4500/login', form, function(userDoc) {
//^ Assuming your server app is listening on 4500, and calls "couchParty.login" with the route above. 
    initPouch(userDoc)
}, 'json')

//Create a database based on the userDoc we got from server: 
function initPouch(userDoc) {
    var db = new PouchDB('myproject_user')
    db.post(userDoc, function(err, res) {
        //Now perform a live sync: 
        db.sync('http://admin:admin@localhost:5984/' + userDoc.db_name, { live: true, retry: true })
          .on('change', function(info) {
            console.log('Now this is a party!')
          })
    })
}
```


### Lost keys

To reset a password, first call couchParty.resetToken to generate and 'seed' the appropriate user with a secret token (then an implied step where you email the user said token) and then call couchParty.resetPass with the token and new password. 

There is no built-in email mecahnism, you can send the email however you like. For example with nodemailer as in the example below.

```
//Post route from a page that collects an email address for the purpose of password reset...
//(app is an express app)
app.post('/api/reset', function(req, res) {
  console.log('A visitor has requested to reset password for: ' + req.body.email)
  //Lookup the username based on the email provided...
  couchParty.resetToken(baseCouchURL, req.body.email, function(err, token) {
    if(err) return res.send({ok:false, msg: err})  
    //the link contains a secret token
    //the secret token is applied to the userDoc in the user database
    //Now you can send the email however you like:
    var email = {
      to: req.body.email, 
      subject:`Password Reset`, 
      from : 'support@worlddomination.com', 
      html: `<p>Hello there,</p>
      <p>There has been a request to reset your password.  If you wish to proceed, click the link below: </p>
      <p><a href="http://worlddomination.com/reset-confirm/${token}">www.worlddomination.com/reset-confirm/token</a></p>
      If for any reason you did not request a password reset please reply back to inform support@worlddomination.com</p>
      `
    }
    //Send the mail: 
    //(nodemailer object initialized already)
    nodemailer.sendMail(email, function(err, nodemailerRes){
      if(err) return console.log(err.message)
      var resultMsg = 'An email with further instruction has been sent to : ' + req.body.email
      res.send({ok:true, msg: resultMsg })
    })
  })
})

//Post route that contains the token; this is hit after the user lands on the URL
//provided in the reset email.
app.post('/api/reset/:secretToken', function(req, res) {
  couchParty.resetPass(baseCouchURL, req.params.secretToken, req.body.new_password, function(err) {
    if(err) return res.send({ok:false, msg: err })
    //If there was no error, the password was reset successfully: 
    res.send({ok:true, msg: 'Password was reset successfully.'})
  })
})
```





