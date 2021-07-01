const { MVLoaderBase } = require('mvloader')
const { YooCheckout } = require('@a2seven/yoo-checkout')
const mt = require('mvtools')

class mvlShopYookassa extends MVLoaderBase {
  constructor (App, ...config) {
    const localDefaults = {
      shopId: '',
      secretKey: '',
      type: 'bank_card',
      currency: 'RUB',
      orderExtKey: 'mvlShopYookassa',
      savePayment: false
    }
    super(localDefaults, ...config)
    this.App = App
    this.Yookassa = new YooCheckout({ shopId: this.config.shopId, secretKey: this.config.secretKey })

    this.STATUSES = {
      PENDING: 'pending',
      PAID: 'succeeded',
      WAITING_CONFIRM: 'waiting_for_capture',
      CANCELED: 'canceled'
    }

    this.caption = 'mvlShopYookassa'
  }

  async init () {
    return super.init()
  }

  async initFinish () {
    await super.initFinish()
    await this.initFillDB()
  }

  cost (payment, order) {
    return payment.cost
  }

  async link (order) {
    const payment = await order.getPayment()
    const createResponse = await this.makePayment(order, payment)
    // console.log('YOOKASSA LINK. RESPONSE', createResponse)
    if (createResponse.success) {
      return this.success('', {
        link: mt.extract('confirmation.confirmation_url', createResponse.data, '')
      })
    }
    return this.failure(createResponse.message, createResponse.data)
  }

  async saved (order) {
    // console.log('YOOKASSA. SAVED. ORDER', order)//, 'PAYMENT', payment)
    const customerPaymentOrKey = order.extended.customerPaymentKey
    const customerPayments = await this.App.ext.controllers.mvlShopCustomerPayment.get(customerPaymentOrKey)
    let msg = ''
    let data = []
    if (customerPayments !== null) {
      // console.log('YOOKASSA. SAVED. CUSTOMER PAYMENT', customerPayments)
      const payment = await customerPayments.getPayment()

      if (payment !== null) {
        const createResponse = await this.makePayment(order, payment)
        // console.log('YOOKASSA LINK. RESPONSE', createResponse)
        if (createResponse.success) {
          if (createResponse.data.status === this.STATUSES.PAID) return this.success()
          msg = 'Not paid'
        }
        msg = createResponse.message
        data = createResponse.data
      } else msg = 'Payment not found'
    }
    return this.failure(msg, data)
  }

  async makePayment (order, payment) {
    // console.log('CUSTOMER PAYMENT SAVE', order.extended.customerPaymentSave, 'EMPTY? ', mt.empty(order.extended.customerPaymentSave))
    // console.log('ORDER EXTENDED', order.extended)
    // console.log('CUSTOMER PAYMENT KEY', order.extended.customerPaymentKey, 'EMPTY? ', mt.empty(order.extended.customerPaymentKey))
    const createPayload = await this.prepareCommonPayload(order, payment)
    if (!mt.empty(order.extended.customerPaymentKey) || !mt.empty(order.extended.customerPaymentId)) {
      const customerPayment = await this.App.ext.controllers.mvlShopCustomerPayment.get(order.extended.customerPaymentId || order.extended.customerPaymentKey)
      if (customerPayment) createPayload.payment_method_id = customerPayment.token
    }
    if (mt.empty(createPayload.payment_method_id)) {
      createPayload.payment_method_data = {
        type: !mt.empty(payment.extended) ? (payment.extended.type || this.config.type) : this.config.type
      }
    }
    // console.log('YOOKASSA. CREATE PAYLOAD', createPayload)
    const yooResponse = await this.createYookassaPayment(createPayload, order)
    if (yooResponse.success) {
      await this.saveExtended(order, { id: yooResponse.data.id })
      await this.storePaid(order, yooResponse.data)
    }
    return yooResponse
  }

  /**
   * @param {Object<string,*>} createPayload
   * @param {mvlShopOrder} order
   * @return {basicResponse}
   */
  async createYookassaPayment (createPayload, order) {
    try {
      const payment = await this.Yookassa.createPayment(createPayload, this.getImdempotence(order))
      console.log(payment)
      return this.success('', payment)
    } catch (error) {
      console.error(error)
      return this.failure(error.response.data.description, error.response.data)
    }
  }

  async saveExtended (order, extended = {}) {
    const orderExtended = order.extended
    orderExtended[this.config.orderExtKey] = orderExtended[this.config.orderExtKey] || {}
    orderExtended[this.config.orderExtKey] = mt.merge(orderExtended, extended)
    order.set('extended', orderExtended)
    await order.save()
  }

  async storePaid (order, yooPayment) {
    if (yooPayment.status === this.STATUSES.PAID) {
      await this.App.ext.controllers.mvlShopOrderStatus.paid(order)
      return this.success()
    }
    return this.failure('Not paid')
  }

  async webhook (cbData) {
    // console.log(cbData)
    let order = null
    if (typeof cbData === 'string') {
      try {
        cbData = JSON.parse(cbData)
      } catch (e) {
        console.error('BROKEN CALLBACK DATA FROM YOOKASSA:', cbData)
        cbData = {}
      }
    }
    if (typeof cbData === 'object') {
      order = await this.App.ext.controllers.mvlShopOrder.get(cbData.object.metadata.orderId)
      if (order !== null) {
        const extended = order.extended
        const yooId = this.MT.extract(this.config.orderExtKey + '.id', extended, '')
        if (yooId === cbData.object.id) {
          switch (cbData.object.status) {
            case this.STATUSES.PAID:
              await this.App.ext.controllers.mvlShopOrderStatus.paid(order)
              if (cbData.object.payment_method.saved) {
                // const profile = await order.getCustomerProfile()
                // if (profile !== null) {
                //   const extended = order.extended
                //   extended[this.config.orderExtKey].payments = extended[this.config.orderExtKey].payments || []
                // }
                const shopPayment = await order.getPayment()
                const paymentData = cbData.object.payment_method
                const customerPayment = {
                  token: paymentData.id,
                  key: this.getCustomerPaymentKey(paymentData, order),
                  name: paymentData.title,
                  mask: this.getShortMask(paymentData),
                  expireYear: paymentData.card.expiry_year,
                  expireMonth: paymentData.card.expiry_month,
                  type: paymentData.type,
                  controller: shopPayment.controller,
                  extended: {
                    cardType: paymentData.card.card_type,
                    fullMask: this.getFullMask(paymentData)
                  }
                }
                // console.log('CUSTOMER PAYMENT ', customerPayment)
                const saveResult = await this.App.ext.controllers.mvlShopCustomerPayment.save(await order.getCustomer(), shopPayment, customerPayment)
                // console.log('CUSTOMER PAYMENT SAVE RESULT', saveResult)
              }
              break
            case this.STATUSES.CANCELED:
              await this.App.ext.controllers.mvlShopOrderStatus.cancelled(order)
              break
          }
        }
      }
    }
    return order
  }

  async prepareCommonPayload (order, payment) {
    // console.log('YOOKASSA. PREPARE COMMON PAYLOAD. ORDER', order)
    return {
      amount: {
        value: order.cost,
        currency: this.config.currency
      },
      capture: true,
      metadata: {
        orderId: order.id
      },
      confirmation: {
        type: 'redirect',
        return_url: await this.App.ext.controllers.mvlShopOrder.getPageLink(true, order)
      },
      save_payment_method: !mt.empty(payment.extended.save_payment_method)
    }
  }

  getCustomerPaymentKey (paymentData, order) {
    const values = [order.CustomerId, order.PaymentId, paymentData.title]
    switch (paymentData.type) {
      case 'bank_card':
        const card = paymentData.card
        values.push(card.first6, card.last4, card.expiry_year, card.expiry_month, card.card_type)
        break
      default:
        break
    }
    return mt.md5(values.join(':'))
  }

  getShortMask (paymentData) {
    return paymentData.type === 'bank_card' ? '*' + paymentData.card.last4 : ''
  }

  getFullMask (paymentData) {
    return paymentData.type === 'bank_card'
      ? paymentData.card.first6.substring(0, 4) + ' ' + paymentData.card.first6.substring(4) + 'xx xxxx ' + paymentData.card.last4
      : ''
  }

  getImdempotence (order) {
    return [order.id, order.StatusId, order.CustomerId, (new Date()).getDate(), (order.extended.customerPaymentKey || '!')].join('-')
  }

  async initFillDB () {
    if (!(await this.App.DB.models.mvlShopPayment.count({ where: { controller: 'mvlShopYookassa' } }))) {
      const promises = []
      const defaults = require('./defaultvalues')
      try {
        for (const object of defaults) {
          promises.push(
            (() => this.App.DB.models.mvlShopPayment.create(object))()
          )
        }
      } catch (e) {
        console.log(e)
      }
      return Promise.allSettled(promises)
    }
  }
}

module.exports = { mvlShopYookassa }
