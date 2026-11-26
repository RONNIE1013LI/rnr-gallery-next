import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpressCheckout } from "./express-checkout";

const stripe = vi.hoisted(() => ({
  callbacks: {} as Record<string, (...args: never[]) => unknown>,
  submit: vi.fn(),
  confirmPayment: vi.fn(),
  load: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: stripe.load }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => children,
  ExpressCheckoutElement: (props: typeof stripe.callbacks) => {
    stripe.callbacks = props;
    return <div data-testid="wallet-element" />;
  },
  useElements: () => ({ submit: stripe.submit }),
  useStripe: () => ({ confirmPayment: stripe.confirmPayment }),
}));

const settings = {
  publishableKey: "pk_test_example",
  amountCents: 7475,
  currency: "NZD" as const,
  disabled: false,
  onAuthorize: vi.fn(),
};

describe("Express Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
  });

  it.each(["Messenger", "Facebook", "Instagram"])("leaves regular payment available without an eligible wallet in %s", (app) => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(app);
    render(<><ExpressCheckout {...settings} /><button>Continue to secure card payment</button></>);
    act(() => stripe.callbacks.onReady({ availablePaymentMethods: undefined } as never));
    expect(screen.queryByRole("heading", { name: "Express Checkout" })).toBeNull();
    expect(screen.getByText("OR")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Continue to secure card payment" })).toBeEnabled();
    userAgent.mockRestore();
  });

  it("hides Express Checkout and the divider on Element load failure", () => {
    render(<><ExpressCheckout {...settings} /><button>Continue to secure card payment</button></>);
    act(() => stripe.callbacks.onReady({ availablePaymentMethods: { applePay: true } } as never));
    expect(screen.getByRole("heading", { name: "Express Checkout" })).toBeVisible();
    act(() => {
      stripe.callbacks.onLoadError({ elementType: "expressCheckout" } as never);
    });
    expect(screen.queryByRole("heading", { name: "Express Checkout" })).toBeNull();
    expect(screen.getByText("OR")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Continue to secure card payment" })).toBeEnabled();
    expect(settings.onAuthorize).not.toHaveBeenCalled();
  });

  it("opens the wallet without submitting Elements or authorizing an order", () => {
    render(<ExpressCheckout {...settings} />);
    const resolve = vi.fn();
    act(() => stripe.callbacks.onReady({ availablePaymentMethods: { applePay: true } } as never));
    act(() => stripe.callbacks.onClick({ resolve, expressPaymentType: "apple_pay" } as never));
    expect(screen.getByRole("heading", { name: "Express Checkout" })).toBeVisible();
    expect(screen.getByText("OR")).toBeVisible();
    expect(resolve).toHaveBeenCalledOnce();
    expect(stripe.submit).not.toHaveBeenCalled();
    expect(settings.onAuthorize).not.toHaveBeenCalled();
  });

  it("validates Elements before asking the server for an Intent and fails closed on invalid details", async () => {
    render(<ExpressCheckout {...settings} />);
    stripe.submit.mockResolvedValueOnce({ error: { message: "Invalid" } });
    settings.onAuthorize.mockImplementationOnce(async ({ validate }) => validate());
    const paymentFailed = vi.fn();
    await act(async () => {
      await stripe.callbacks.onConfirm({ expressPaymentType: "google_pay", paymentFailed } as never);
    });
    expect(stripe.submit).toHaveBeenCalledOnce();
    expect(paymentFailed).toHaveBeenCalledOnce();
    expect(stripe.confirmPayment).not.toHaveBeenCalled();
  });
});
