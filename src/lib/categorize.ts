/** Keyword → default category name, used when the merchant has never been categorised before. */
const RULES: [RegExp, string][] = [
  [/blinkit|zepto|instamart|bigbasket|bbnow|dmart|jiomart|grocer|kirana|supermarket|more retail|nature'?s basket|flipkart ?gr|flipkart minutes/i, 'Groceries'],
  [/swiggy|zomato|eatsure|domino|pizza|mcdonald|kfc|burger|starbucks|cafe|coffee|restaurant|dhaba|biryani|chaayos|haldiram/i, 'Food & Dining'],
  [/uber|ola\b|rapido|namma yatri|metro|bmtc|dtc|auto|cab|parking|fastag/i, 'Transport'],
  [/petrol|fuel|hpcl|bpcl|iocl|indian oil|bharat petroleum|shell|nayara/i, 'Fuel'],
  [/irctc|makemytrip|goibibo|cleartrip|yatra|indigo|air ?india|vistara|akasa|spicejet|redbus|ixigo|oyo|hotel|airbnb|booking\.com|agoda/i, 'Travel'],
  [/bookmyshow|pvr|inox|cinepolis|district|paytm insider|gaming|steam/i, 'Entertainment'],
  [/netflix|spotify|prime video|hotstar|jiocinema|youtube|apple\.com|google play|icloud|chatgpt|openai|anthropic|claude/i, 'Subscriptions'],
  [/airtel|jio|vodafone|\bvi\b|bsnl|electricity|bescom|tata power|adani|water|gas|broadband|act fibernet|recharge|bill ?desk|lpg|indane/i, 'Bills & Utilities'],
  [/apollo|pharm|1mg|netmeds|medplus|hospital|clinic|diagnostic|lab|practo|dr\.? /i, 'Health'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|tata ?cliq|croma|reliance digital|decathlon|ikea|lifestyle|westside|zara|h&m|uniqlo/i, 'Shopping'],
  [/salon|spa|urban ?company|barber|grooming/i, 'Personal Care'],
  [/udemy|coursera|byju|unacademy|school|college|tuition|books/i, 'Education'],
  [/rent|nobroker|nestaway/i, 'Rent'],
];

export function suggestCategoryName(merchant: string): string | undefined {
  return RULES.find(([re]) => re.test(merchant))?.[1];
}
