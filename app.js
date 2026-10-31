/**
 * BACKEND GATEWAY: FAUCETPAY & FIREBASE INTEGRATION
 * Merchant: isaiahotico
 * Firebase DB: https://freegcash-ads-default-rtdb.asia-southeast1.firebasedatabase.app
 */

const FAUCETPAY_API_KEY = "YOUR_FAUCETPAY_API_KEY"; // FaucetPay Settings > API
const MERCHANT_USERNAME = "isaiahotico";
const FIREBASE_DB_URL = "https://freegcash-ads-default-rtdb.asia-southeast1.firebasedatabase.app";

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    let params = {};
    if (e.postData && e.postData.contents) {
      try {
        params = JSON.parse(e.postData.contents);
      } catch (err) {
        params = e.parameter;
      }
    } else {
      params = e.parameter || {};
    }

    const action = params.action;

    // 1. IPN WEBHOOK FROM FAUCETPAY (Deposit in any coin -> USD credit)
    if (action === "faucetpay_ipn" || params.token) {
      return handleFaucetPayDeposit(params);
    }

    // 2. AUTOMATED WITHDRAWAL IN USDT
    if (action === "withdraw") {
      return jsonResponse(processWithdrawal(params.uid, params.amount_usd, params.address));
    }

    return jsonResponse({ status: "error", message: "Invalid action" });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// FaucetPay IPN Webhook Handler -> Auto Credits Firebase Realtime DB
function handleFaucetPayDeposit(params) {
  const uid = params.custom; // User's Firebase UID passed from client
  const amountUsd = parseFloat(params.amount_usd || params.amount1 || 0);
  const cryptoCurrency = params.currency1 || params.currency || "ANY";
  const cryptoAmount = params.amount || 0;
  const txId = params.transaction_id || ("tx_" + new Date().getTime());

  if (!uid || amountUsd <= 0) {
    return ContentService.createTextOutput("FAILURE: Invalid parameters");
  }

  // Get current user profile from Firebase RTDB REST API
  const userUrl = FIREBASE_DB_URL + "/users/" + uid + ".json";
  const userRes = UrlFetchApp.fetch(userUrl, { muteHttpExceptions: true });
  let user = JSON.parse(userRes.getContentText());

  if (!user) {
    user = { balance_usd: 0, email: "" };
  }

  const currentBal = parseFloat(user.balance_usd || 0);
  const newBalance = currentBal + amountUsd;

  // 1. Update user balance in Firebase
  UrlFetchApp.fetch(FIREBASE_DB_URL + "/users/" + uid + "/balance_usd.json", {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(newBalance)
  });

  // 2. Log transaction in Firebase /history/
  const txPayload = {
    tx_id: txId,
    uid: uid,
    type: "DEPOSIT",
    amount_usd: amountUsd,
    crypto_currency: cryptoCurrency,
    crypto_amount: cryptoAmount,
    status: "COMPLETED",
    timestamp: new Date().toISOString()
  };

  UrlFetchApp.fetch(FIREBASE_DB_URL + "/history/" + uid + "/" + txId + ".json", {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(txPayload)
  });

  return ContentService.createTextOutput("*OK*");
}

// Automated USDT Payout Handler
function processWithdrawal(uid, amountUsd, toAddress) {
  amountUsd = parseFloat(amountUsd);
  if (!uid || isNaN(amountUsd) || amountUsd <= 0 || !toAddress) {
    return { status: "error", message: "Invalid parameters" };
  }

  // Read balance from Firebase
  const userUrl = FIREBASE_DB_URL + "/users/" + uid + ".json";
  const userRes = UrlFetchApp.fetch(userUrl, { muteHttpExceptions: true });
  const user = JSON.parse(userRes.getContentText());

  if (!user) return { status: "error", message: "User not found" };

  const currentBal = parseFloat(user.balance_usd || 0);
  if (currentBal < amountUsd) {
    return { status: "error", message: "Insufficient balance" };
  }

  // Deduct balance first
  const newBal = currentBal - amountUsd;
  UrlFetchApp.fetch(FIREBASE_DB_URL + "/users/" + uid + "/balance_usd.json", {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(newBal)
  });

  // Call FaucetPay Send API (USDT)
  // FaucetPay expects satoshis (1 USDT = 100,000,000 satoshis)
  const satoshiUSDT = Math.floor(amountUsd * 100000000);
  const payload = {
    api_key: FAUCETPAY_API_KEY,
    amount: satoshiUSDT,
    to: toAddress,
    currency: "USDT"
  };

  const response = UrlFetchApp.fetch("https://faucetpay.io/api/v1/send", {
    method: "post",
    payload: payload,
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (result.status === 200) {
    const txId = result.payout_id || ("tx_" + new Date().getTime());
    
    // Record withdrawal history in Firebase
    const txPayload = {
      tx_id: txId,
      uid: uid,
      type: "WITHDRAWAL",
      amount_usd: amountUsd,
      crypto_currency: "USDT",
      crypto_amount: amountUsd,
      status: "COMPLETED",
      timestamp: new Date().toISOString()
    };

    UrlFetchApp.fetch(FIREBASE_DB_URL + "/history/" + uid + "/" + txId + ".json", {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(txPayload)
    });

    return { status: "success", message: "Withdrawal sent instantly!", tx_id: txId };
  } else {
    // Refund balance on API failure
    UrlFetchApp.fetch(FIREBASE_DB_URL + "/users/" + uid + "/balance_usd.json", {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(currentBal)
    });

    return { status: "error", message: "FaucetPay Error: " + (result.message || "Payout declined") };
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}