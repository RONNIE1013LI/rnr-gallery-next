export const deliveryCopy = Object.freeze({
  production: "Standard production time is 5 business days from the date the order is placed.",
  newZealand: "New Zealand: 2–3 business days after production.",
  australiaDhl: "DHL Express to a major city on Australia’s east coast usually takes around 2 days after production.",
  australiaStandard: "Standard delivery to Australia usually takes around 7–10 days after production.",
  australiaRemote: "For remote areas, both options can take around two weeks because additional local transit time may be required.",
});

export const australiaDeliverySummary = [
  deliveryCopy.australiaDhl,
  deliveryCopy.australiaStandard,
  deliveryCopy.australiaRemote,
].join(" ");
