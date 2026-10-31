/**
 * BACKEND GATEWAY: EMAIL-ONLY FAUCETPAY + FIREBASE RTDB
 * Merchant: isaiahotico
 */

const FAUCETPAY_API_KEY = "YOUR_FAUCETPAY_API_KEY"; // From FaucetPay Settings > API
const MERCHANT_USERNAME = "isaiahotico";
const FIREBASE_DB_URL = "https://freegcash-ads-default-rtdb.asia-southeast1.firebasedatabase.app";

// Helper: Sanitize email to make it a safe Firebase key
function sanitizeKey(email) {
  if (!email) return "";
  return email.toLowerCase().replace(/\./g, "_dot_").replace(/@/g, "_at_").replace(/[#$\[\]]/g, "_");
}

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

    // 1. IPN WEBHOOK FROM FAUCETPAY (Deposit completed in any coin)
    if (action === "faucetpay_ipn" || params.token) {
      return handleFaucetPayDeposit(params);
    }

    // 2. AUTOMATED WITHDRAWAL IN USDT
    if (action === "withdraw") {
      return jsonResponse(processWithdrawal(params.email, params.amount_usd));
    }

    return jsonResponse({ status: "error", message: "Invalid action" });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// FaucetPay IPN Webhook: Credits USD to the user's email node
function handleFaucetPayDeposit(params) {
  // 'custom' passes the user's raw email
  const rawEmail = (params.custom || "").trim().toLowerCase();
  const amountUsd = parseFloat(params.amount_usd || params.amount1 || 0);
  const cryptoCurrency = params.currency1 || params.currency || "ANY";
  const cryptoAmount = params.amount || 0;
  const txId = params.transaction_id || ("tx_" + new Date().getTime());

  if (!rawEmail || amountUsd <= 0) {
    return ContentService.createTextOutput("FAILURE: Invalid parameters");
  }

  const userKey = sanitizeKey(rawEmail);

  // Fetch current user balance
  const userUrl = FIREBASE_DB_URL + "/users/" + userKey + ".json";
  const userRes = UrlFetchApp.fetch(userUrl, { muteHttpExceptions: true });
  let user = JSON.parse(userRes.getContentText());

  const currentBal = (user && user.balance_usd) ? parseFloat(user.balance_usd) : 0;
  const newBalance = currentBal + amountUsd;

  // 1. Update user balance in Firebase
  UrlFetchApp.fetch(FIREBASE_DB_URL + "/users/" + userKey + "/balance_usd.json", {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(newBalance)
  });

  // Ensure email field exists
  UrlFetchApp.fetch(FIREBASE_DB_URL + "/users/" + userKey + "/email.json", {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(rawEmail)
  });

  // 2. Record transaction in Firebase /history/
  const txPayload = {
    tx_id: txId,
    email: rawEmail,
    type: "DEPOSIT",
    amount_usd: amountUsd,
    crypto_currency: cryptoCurrency,
    crypto_amount: cryptoAmount,
    status: "COMPLETED",
    timestamp: new Date().toISOString()
  };

  UrlFetchApp.fetch(FIREBASE_DB_URL + "/history/" + userKey + "/" + txId + ".json", {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(txPayload)
  });

  return ContentService.createTextOutput("*OK*");
}

// Automated USDT Payout via FaucetPay API
function processWithdrawal(rawEmail, amountUsd) {
  rawEmail = (rawEmail || "").trim().toLowerCase();
  amountUsd = parseFloat(amountUsd);

  if (!rawEmail || isNaN(amountUsd) || amountUsd <= 0) {
    return { status: "error", message: "Invalid email or withdrawal amount." };
  }

  const userKey = sanitizeKey(rawEmail);

  // Read current balance from Firebase
  const userUrl = FIREBASE_DB_URL + "/users/" + userKey + ".json";
  const userRes = UrlFetchApp.fetch(userUrl, { muteHttpExceptions: true });
  const user = JSON.parse(userRes.getContentText());

  if (!user) return { status: "error", message: "User account not found." };

  const currentBal = parseFloat(user.balance_usd || 0);
  if (currentBal < amountUsd) {
    return { status: "error", message: "Insufficient balance. Available: $" + currentBal.toFixed(2) };
  }

  // Deduct balance first
  const newBal = currentBal - amountUsd;
  UrlFetchApp.fetch(FIREBASE_DB_URL + "/users/" + userKey + "/balance_usd.json", {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(newBal)
  });

  // FaucetPay send API (1 USDT = 100,000,000 satoshis)
  // "to" parameter accepts linked crypto addresses or FaucetPay account emails
  const satoshiUSDT = Math.floor(amountUsd * 100000000);
  const payload = {
    api_key: FAUCETPAY_API_KEY,
    amount: satoshiUSDT,
    to: rawEmail,
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

    // Record withdrawal in history
    const txPayload = {
      tx_id: txId,
      email: rawEmail,
      type: "WITHDRAWAL",
      amount_usd: amountUsd,
      crypto_currency: "USDT",
      crypto_amount: amountUsd,
      status: "COMPLETED",
      timestamp: new Date().toISOString()
    };

    UrlFetchApp.fetch(FIREBASE_DB_URL + "/history/" + userKey + "/" + txId + ".json", {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(txPayload)
    });

    return { status: "success", message: "Instant USDT payout completed!", tx_id: txId };
  } else {
    // Refund balance if FaucetPay API rejects the transfer
    UrlFetchApp.fetch(FIREBASE_DB_URL + "/users/" + userKey + "/balance_usd.json", {
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