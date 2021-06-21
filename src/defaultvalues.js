module.exports = [
  {
    name: 'ЮКасса Банковская карта',
    key: 'yookassaBankCard',
    cost: 0,
    active: false,
    controller: 'mvlShopYookassa',
    rank: 2,
    extended: {
      type: 'bank_card'
    }
  },
  {
    name: 'ЮКасса Банковская карта (сохранить)',
    key: 'yookassaBankCardSave',
    cost: 0,
    active: false,
    controller: 'mvlShopYookassa',
    rank: 3,
    extended: {
      type: 'bank_card',
      save_payment_method: true
    }
  },
  {
    name: 'ЮКасса ЮМани',
    key: 'yookassaYoomoney',
    cost: 0,
    active: false,
    controller: 'mvlShopYookassa',
    rank: 4,
    extended: {
      type: 'yoo_money'
    }
  },
  {
    name: 'ЮКасса Киви-кошелёк',
    key: 'yookassaQiwi',
    cost: 0,
    active: false,
    controller: 'mvlShopYookassa',
    rank: 5,
    extended: {
      type: 'qiwi'
    }
  },
  {
    name: 'ЮКасса Webmoney',
    key: 'yookassaWebmoney',
    cost: 0,
    active: false,
    controller: 'mvlShopYookassa',
    rank: 6,
    extended: {
      type: 'webmoney'
    }
  }
]
