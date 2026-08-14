import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthGateway, type SocialAuthClient } from "./auth-gateway";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

function createSocialClient(): SocialAuthClient {
  return {
    signIn: {
      social: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}

describe("AuthGateway", () => {
  it("shows configured social choices and hides unavailable providers", () => {
    render(
      <AuthGateway
        configuredProviders={["google", "apple"]}
        mode="sign-in"
        socialClient={createSocialClient()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Continue with GitHub" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  });

  it("shows the Google provider with its multicolour brand mark", () => {
    render(
      <AuthGateway
        configuredProviders={["google"]}
        mode="sign-in"
        socialClient={createSocialClient()}
      />,
    );

    const googleButton = screen.getByRole("button", { name: "Continue with Google" });
    const googleMark = googleButton.querySelector("svg");
    const brandColours = new Set(
      [...(googleMark?.querySelectorAll("[fill]") ?? [])].map((element) =>
        element.getAttribute("fill"),
      ),
    );

    expect(googleMark).toBeInTheDocument();
    expect(brandColours.size).toBeGreaterThanOrEqual(4);
  });

  it("starts social sign-in with an account callback", async () => {
    const socialClient = createSocialClient();
    render(
      <AuthGateway
        configuredProviders={["google"]}
        mode="sign-in"
        socialClient={socialClient}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => {
      expect(socialClient.signIn.social).toHaveBeenCalledWith({
        callbackURL: "/account",
        provider: "google",
      });
    });
  });

  it("keeps Google sign-in inside the app when the current origin is a private LAN address", async () => {
    const socialClient = createSocialClient();
    render(
      <AuthGateway
        configuredProviders={["google"]}
        mode="sign-in"
        oauthOrigin="http://192.168.4.199:3000"
        socialClient={socialClient}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText(
      "Google sign-in requires the secure deployed site. Continue with Email for local testing.",
    )).toBeInTheDocument();
    expect(socialClient.signIn.social).not.toHaveBeenCalled();
  });

  it("starts staff social sign-in with a forms callback", async () => {
    const socialClient = createSocialClient();
    render(
      <AuthGateway
        audience="forms"
        configuredProviders={["google"]}
        mode="sign-in"
        returnTo="/order-system/jobs/abc"
        socialClient={socialClient}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => {
      expect(socialClient.signIn.social).toHaveBeenCalledWith({
        callbackURL: "/order-system/jobs/abc",
        provider: "google",
      });
    });
    expect(screen.getByText("Forms operator access")).toBeInTheDocument();
  });

  it("returns Google sign-in to checkout", async () => {
    const socialClient = createSocialClient();
    render(
      <AuthGateway
        configuredProviders={["google"]}
        mode="sign-in"
        returnTo="/checkout"
        showIntro={false}
        socialClient={socialClient}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => {
      expect(socialClient.signIn.social).toHaveBeenCalledWith({
        callbackURL: "/checkout",
        provider: "google",
      });
    });
  });

  it("reveals email authentication and links to legal terms", () => {
    render(
      <AuthGateway
        configuredProviders={[]}
        mode="register"
        socialClient={createSocialClient()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Email" }));

    expect(screen.getByLabelText("Full name")).toBeVisible();
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByText((_, element) => (
      element?.tagName === "SPAN"
      && element.textContent === "Terms of Service and Privacy Policy."
    ))).toBeInTheDocument();
  });

  it("can hide the account-page introduction inside checkout", () => {
    render(
      <AuthGateway
        configuredProviders={["google"]}
        mode="sign-in"
        returnTo="/checkout"
        showIntro={false}
        socialClient={createSocialClient()}
      />,
    );

    expect(screen.queryByText("Customer account")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome back." })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue with Email" })).toBeEnabled();
  });
});
