"use client";

/**
 * Checkout Page — /checkout/[checkoutId]
 *
 * Displays cart summary + billing form + Stripe Elements CardElement.
 * On submit, Stripe.js tokenizes the card client-side (inside Stripe's iframe),
 * then POSTs only the resulting pm_xxx to the server payment API.
 *
 * The server NEVER sees raw card data — only the Stripe PaymentMethod ID.
 * This is the PCI-compliant browser-use checkout flow.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ShoppingBag, CheckCircle2, XCircle } from "lucide-react";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface CartData {
  id: string;
  items: CartItem[];
  total: number;
  status: string;
}

interface PaymentResult {
  orderId?: string;
  stripePaymentIntentId?: string;
  amount?: string;
  status?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Billing form fields — Playwright fills these by name attribute
// ---------------------------------------------------------------------------

interface BillingFields {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const INITIAL_BILLING: BillingFields = {
  fullName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
};

// ---------------------------------------------------------------------------
// CheckoutForm — inner component that has access to Stripe hooks
// ---------------------------------------------------------------------------

function CheckoutForm({ cart }: { cart: CartData }) {
  const stripe = useStripe();
  const elements = useElements();
  const params = useParams();
  const checkoutId = params.checkoutId as string;

  const [billing, setBilling] = useState<BillingFields>(INITIAL_BILLING);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);

  const updateField = useCallback(
    (field: keyof BillingFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setBilling((prev) => ({ ...prev, [field]: e.target.value }));
    },
    []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setResult(null);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        setResult({ error: "Card element not found" });
        setSubmitting(false);
        return;
      }

      const { error: pmError, paymentMethod } =
        await stripe.createPaymentMethod({
          type: "card",
          card: cardElement,
          billing_details: {
            name: billing.fullName,
            email: billing.email,
            phone: billing.phone,
            address: {
              line1: billing.address,
              city: billing.city,
              state: billing.state,
              postal_code: billing.zip,
            },
          },
        });

      if (pmError) {
        setResult({ error: pmError.message ?? "Card tokenization failed" });
        setSubmitting(false);
        return;
      }

      const res = await fetch(`/api/checkout/${checkoutId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId: paymentMethod.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.error ?? "Payment failed" });
      } else {
        setResult(data);
      }
    } catch (err) {
      setResult({
        error: err instanceof Error ? err.message : "Unexpected error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (result && !result.error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <CheckCircle2 className="size-12 text-green-600" />
          <h2 className="text-xl font-semibold" data-testid="checkout-success">
            Payment Successful
          </h2>
          <p className="text-muted-foreground text-sm">
            Order ID: {result.orderId}
          </p>
          <p className="text-muted-foreground text-sm">
            Amount: {result.amount}
          </p>
          <p className="text-muted-foreground text-sm">
            Stripe PI: {result.stripePaymentIntentId}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Cart Summary */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="size-5" />
            Order Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {cart.items.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {item.quantity}x {item.productName}
                </span>
                <span className="font-medium">
                  ${(item.unitPrice * item.quantity).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="border-t pt-2 flex items-center justify-between font-semibold">
              <span>Total</span>
              <span>${cart.total.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Details */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Billing Details</CardTitle>
          <CardDescription>
            Shipping and billing information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">
                Full Name
              </label>
              <Input
                name="fullName"
                value={billing.fullName}
                onChange={updateField("fullName")}
                placeholder="Jane Doe"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Email</label>
              <Input
                name="email"
                type="email"
                value={billing.email}
                onChange={updateField("email")}
                placeholder="jane@example.com"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Phone</label>
              <Input
                name="phone"
                type="tel"
                value={billing.phone}
                onChange={updateField("phone")}
                placeholder="+1 555 123 4567"
              />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">Address</label>
              <Input
                name="address"
                value={billing.address}
                onChange={updateField("address")}
                placeholder="123 Main St"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">City</label>
              <Input
                name="city"
                value={billing.city}
                onChange={updateField("city")}
                placeholder="San Francisco"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">State</label>
              <Input
                name="state"
                value={billing.state}
                onChange={updateField("state")}
                placeholder="CA"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                ZIP Code
              </label>
              <Input
                name="zip"
                value={billing.zip}
                onChange={updateField("zip")}
                placeholder="94102"
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card Input (Stripe Elements) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <CardDescription>
            Card details are handled securely by Stripe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-input p-3">
            <CardElement
              options={{
                style: {
                  base: {
                    fontSize: "16px",
                    color: "#09090b",
                    "::placeholder": { color: "#71717a" },
                  },
                },
                hidePostalCode: true,
              }}
            />
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-3">
          {result?.error && (
            <div
              className="flex items-center gap-2 text-destructive text-sm w-full"
              data-testid="checkout-error"
            >
              <XCircle className="size-4 shrink-0" />
              {result.error}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={!stripe || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Processing...
              </>
            ) : (
              `Pay $${cart.total.toFixed(2)}`
            )}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page — loads cart data and wraps form in Stripe Elements provider
// ---------------------------------------------------------------------------

export default function CheckoutPage() {
  const params = useParams();
  const checkoutId = params.checkoutId as string;

  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCart() {
      try {
        const res = await fetch(`/api/merchant/cart/${checkoutId}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Cart not found");
          return;
        }
        const data = await res.json();
        if (data.status !== "checked_out") {
          setError(`Cart status is "${data.status}" — must be checked out first`);
          return;
        }
        setCart(data);
      } catch {
        setError("Failed to load cart");
      } finally {
        setLoading(false);
      }
    }
    loadCart();
  }, [checkoutId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !cart) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-lg px-4 py-12 text-center">
          <XCircle className="mx-auto mb-4 size-12 text-destructive" />
          <h1 className="text-2xl font-bold mb-2">Checkout Error</h1>
          <p className="text-muted-foreground" data-testid="checkout-error">
            {error ?? "Cart not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
          <p className="mt-2 text-muted-foreground">
            Complete your purchase securely
          </p>
        </div>

        <Elements stripe={stripePromise}>
          <CheckoutForm cart={cart} />
        </Elements>
      </div>
    </div>
  );
}
