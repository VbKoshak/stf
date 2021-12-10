const request = require('request-promise')
const Promise = require('bluebird')
const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../../util/logger')
const iosutil = require('../util/iosutil')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')

const WDA_UNAVAILABLE_MSG = 'RequestError'
const LOG_API_REQUEST_MSG = 'Has been sent api request to WDA with data :'

module.exports = syrup.serial()
  .dependency(require('../devicenotifier'))
  .dependency(require('../../support/push'))
  .define((options, notifier, push) => {
    const log = logger.createLogger('wdaClient')
    log.info("WdaClient.js initializing...")

    const WdaClient = {
      isStarted: false,
      touchDownParams: {},
      isMove: false,
      port: null,
      baseUrl: iosutil.getUri(options.wdaHost, options.wdaPort),
      sessionId: null,
      tapStartAt: 0,
      orientation: 'PORTRAIT',
      deviceSize: null,
      isInitialized: false,
      connect: function () {
        return new Promise((resolve, reject) => {
          request.get(`${this.baseUrl}/status`)
            .then(response => {
              this.sessionId = JSON.parse(response).sessionId
              log.info('sessionId: ' + this.sessionId)
              return resolve()
            })
            .catch(err => {
              log.error('No valid response from web driver!', err)
              return reject(err)
            })
        })
      },
      isAlive: function() {
        if (this.sessionId == null) {
          return false
        }
        log.info("verifying existing wda session: " + this.sessionId)

        request.get(`${this.baseUrl}/session/${this.sessionId}`)
          .then(response => {
            log.info("response detected during sessionId verification: " + this.sessionId)
            if (this.sessionId == JSON.parse(response).sessionId) {
              log.info("current sessionId is good: " + this.sessionId)
              return true
            } else {
              log.info("current sessionId is NOT good: " + this.sessionId)
              this.sessionId = null
              return false
            }
          })
          .catch(err => {
            // do nothing as of now but later think about wda state verification at all!
            log.error("error detected during sessionId verification: " + this.sessionId, err)
            return false
          })
      },

      startSession: function() {
        if (!this.isAlive()) {
          log.info("starting wda session...")
          let params = {
            capabilities: {}
          }

          this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session`,
            body: params,
            json: true
          })
          this.connect()
          this.isStarted = true
        }
      },
      stopSession: function() {
        if (this.isStarted) {
          this.isStarted = false
          log.info("stopping wda session... temporary commented")

//          this.handleRequest({
//            method: 'DELETE',
//            uri: `${this.baseUrl}/session/${this.sessionId}` 
//          })
//          this.sessionId = null
        }
      },
      setScaleByRotation: function(params, deviceSize) {
        return iosutil.swipe(this.orientation, params, deviceSize)
      },
      swipe: function(params) {
        const scale = this.setScaleByRotation(params, this.deviceSize)
        this.isMove = true
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/dragfromtoforduration`,
          body: scale,
          json: true
        })
      },
      touchUp: function() {
        if(!this.isMove) {
          const {x, y} = this.touchDownParams
          let params = {
            x: x * this.deviceSize.width,
            y: y * this.deviceSize.height
          }

          if(((new Date()).getTime() - this.tapStartAt) <= 1000 || !this.tapStartAt) {
            return this.handleRequest({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/wda/tap/0`,
              body: params,
              json: true
            })
          }
          else {
            return this.handleRequest({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/wda/touchAndHold`,
              body: Object.assign(params, {duration: 1}),
              json: true
            })
          }
        }
      },
      tapDeviceTreeElement: function(message) {
        const params = {
          using: 'link text',
          value: 'label=' + message.label,
        }

        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/elements`,
            body: params,
            json: true
          })
            .then(response => {
              const {ELEMENT} = response.value[0]
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/element/${ELEMENT}/click`,
                body: {},
                json: true
              })
            })
            .catch(err => {
              log.error(err)
            })
        })
      },
      doubleClick: function() {
        if(!this.isMove) {
          const {x, y} = this.touchDownParams
          const params = {
            x: x * this.deviceSize.width,
            y: y * this.deviceSize.height
          }

          return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/doubleTap`,
            body: params,
            json: true
          })
        }
      },
      tap: function(params) {
        this.tapStartAt = (new Date()).getTime()
        this.touchDownParams = params
        this.isMove = false
      },
      homeBtn: function() {
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/wda/homescreen`
        })
      },
      size: function() {
        log.info(`window size: ${this.baseUrl}/session/${this.sessionId}/window/size`)

        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/session/${this.sessionId}/window/size`
          })
            .then(response => {
              try {
                this.deviceSize = JSON.parse(response).value
                return resolve(this.deviceSize)
              }
              catch (e) {
                return reject(new Error('Failed to parse json object'))
              }
            })
            .catch(err => {
              return reject(err)
            })
        })
      },
      typeKey: function(params) {
        if (!params.value || !params.value[0]) {
          return
        }

        log.info("typeKeys: " + params)
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/keys`,
          body: params,
          json: true
        })
      },
      openUrl: function(message) {
        log.info("opening url: " + message.url)
        const params = {
          capabilities: {
            alwaysMatch: {
              bundleId: 'com.apple.mobilesafari',
              shouldWaitForQuiescence: false
            }
          }
        }

        // as new browser will be opened we have to finish current session!
        this.stopSession()

        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session`,
            body: params,
            json: true
          })
            .then(response => {
              this.sessionId = response.value.sessionId
              const params = {
                url: message.url
              }
              this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/` + this.sessionId + `/url`,
                body: params,
                json: true
              })

              return resolve()
            })
            .catch(err => reject(err))
        })
      },
      rotation: function(params) {
        this.orientation = params.orientation

          return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
            body: params,
            json: true
          })
      },
      screenshot: function() {
        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/screenshot`,
            json: true
          })
            .then(response => {
              try {
                resolve(response)
              } catch(e) {
                reject(e)
              }
            })
            .catch(err => reject(err))
        })
      },
      getTreeElements: function() {
        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/source?format=json`,
          json: true
        })
      },
      batteryIosEvent: function() {
        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/batteryInfo`,
          json: true
        })
      },
      sdkVersion: function() {
      return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/session/${this.sessionId}`,
          json: true
        })
      },
      pressButton: function(params) {
        return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
            body: {
              name: params
            },
            json: true
        })
      },
      appActivate: function(params) {
        return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/apps/activate`,
            body: {
              bundleId: params
            },
            json: true
        })
      },
      pressPower: function() {
        return this.handleRequest({
        method: 'GET',
        uri: `${this.baseUrl}/session/${this.sessionId}/wda/locked`,
        json: true
      })
      .then(response => {
        let url = ''
          if(response.value === true) {
            url = `${this.baseUrl}/session/${this.sessionId}/wda/unlock`
          }
          else{
            url = `${this.baseUrl}/session/${this.sessionId}/wda/lock`
          }
          return this.handleRequest({
            method: 'POST',
            uri: url,
            json: true
          })
      })
      },
      removeSession: function() {
        return this.handleRequest({
          method: 'DELETE',
          uri: `${this.baseUrl}/session/${this.sessionId}`
        })
      },
      handleRequest: function(requestOpt) {
        return new Promise((resolve, reject) => {
          request(requestOpt)
            .then(response => {
              log.verbose(LOG_API_REQUEST_MSG, JSON.stringify(requestOpt))
              return resolve(response)
            })
            .catch(err => {
              // in case if session is expired
              if (err.statusCode === 404) {
                const oldSessionId = this.sessionId

                this.connect()
                .then(() => {
                  const newUri = requestOpt.uri.replace(oldSessionId, this.sessionId)
                  log.verbose(LOG_API_REQUEST_MSG, JSON.stringify(requestOpt))

                  this.handleRequest(Object.assign({}, requestOpt, {
                    uri: newUri
                  }))
                    .then(response => resolve(response))
                })
                .catch(err => {
                  notifier.setDeviceTemporaryUnavialable(err)
                  return reject(err)
                })
              }
              else if(err.name === WDA_UNAVAILABLE_MSG) {
                notifier.setDeviceTemporaryUnavialable(err)
                return reject(err)
              }
              else {
                log.error('Failed to send request with error', err)
              }
            })
        })
      },
      setInitialized: function() {
        this.isInitialized = true
      },
      initializeDeviceData: function() {
        return new Promise((resolve, reject) => {
          try {
            this.size()
            .then(response => {
              const {height, width} = response

              push.send([
                wireutil.global,
                wireutil.envelope(new wire.SizeIsoDevice(
                  options.serial,
                  height,
                  width
                ))
              ])

              this.batteryIosEvent()
                .then(response => {
                  push.send([
                    wireutil.global,
                    wireutil.envelope(new wire.BatteryIosEvent(
                      options.serial,
                      parseInt(response.value.state),
                      parseInt(response.value.level * 100)
                    ))
                  ])
                })
                .catch(err => log.info(err))
              this.sdkVersion()
              .then(response => {
                push.send([
                  wireutil.global,
                  wireutil.envelope(new wire.SdkIosVersion(
                    options.serial,
                    response.value.capabilities.device,
                    response.value.capabilities.sdkVersion
                  ))
                ])
              })
              .catch(err => log.info(err))
              resolve()
            })
            .catch(err => {
              reject(err)
            })
          }
          catch(err) {
            log.error(err)
          }
        })
      }
    }

  /* eslint-disable */
  return new Proxy(WdaClient, {
    get(target, prop) {
      log.info(WdaClient.sessionId)
      // (touchUp, doubleClick, swipe) - those functions require initialization before running
      if (['touchUp', 'doubleClick', 'swipe'].includes(prop) && !target.isInitialized) {
          return (...args) => {
            target.initializeDeviceData()
              .then(response => {
                target.setInitialized()
                let value = target[prop];
                return (typeof value === 'function') ? value.call(target, args[0]) : value;
              })
              .catch(err => log.error(err))
          }

      } else {
        let value = target[prop];
        return (typeof value === 'function') ? value.bind(target) : value;
      }
    }
  })
})
