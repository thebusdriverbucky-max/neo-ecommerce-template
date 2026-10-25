"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Star, User, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { StoreImage } from "@/components/ui/StoreImage";

const reviewSchema = z.object({
  rating: z.number().int().min(1, "Please select a rating").max(5),
  comment: z.string().trim().min(5, "Comment must be at least 5 characters long").max(2000, "Comment must be 2000 characters or fewer"),
});

type ReviewFormValues = z.infer<typeof reviewSchema>;

interface Review {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  user: {
    name: string | null;
    image: string | null;
  };
}

interface ProductReviewsProps {
  productId: string;
  /** Archived products keep their reviews visible but accept no new ones. */
  readOnly?: boolean;
}

async function serverMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

export const ProductReviews = ({ productId, readOnly = false }: ProductReviewsProps) => {
  const { data: session } = useSession();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      rating: 0,
      comment: "",
    },
  });

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/reviews`);
      if (!res.ok) throw new Error("Failed to fetch reviews");
      const data = await res.json();
      setReviews(data);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const onSubmit = async (data: ReviewFormValues) => {
    if (!session) {
      toast.error("Please log in to leave a review");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/products/${productId}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        toast.error(await serverMessage(res, `Could not add your review (HTTP ${res.status}).`));
        return;
      }

      toast.success("Review added successfully!");
      form.reset();
      fetchReviews();
    } catch (error) {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!confirm("Are you sure you want to delete this review?")) return;

    try {
      const res = await fetch(`/api/products/${productId}/reviews?reviewId=${reviewId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        toast.error(await serverMessage(res, `Could not delete the review (HTTP ${res.status}).`));
        return;
      }

      toast.success("Review deleted");
      fetchReviews();
    } catch (error) {
      toast.error("Could not reach the server. Check your connection and try again.");
    }
  };

  const averageRating =
    reviews.length > 0
      ? reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length
      : 0;

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Reviews ({reviews.length})</h2>

      <div className="flex items-center gap-4">
        <div className="flex items-center">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={`w-6 h-6 ${star <= Math.round(averageRating)
                ? "text-yellow-400 fill-yellow-400"
                : "text-gray-300"
                }`}
            />
          ))}
        </div>
        <span className="text-lg font-medium">
          {averageRating.toFixed(1)} out of 5
        </span>
      </div>

      {readOnly ? (
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg text-center">
          <p>This product is no longer available, so new reviews are closed.</p>
        </div>
      ) : session ? (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 border dark:border-gray-700 p-4 rounded-lg">
          <h3 className="text-lg font-semibold">Leave a review</h3>

          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => form.setValue("rating", star)}
                className="focus:outline-none"
              >
                <Star
                  className={`w-8 h-8 ${star <= form.watch("rating")
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-gray-300"
                    }`}
                />
              </button>
            ))}
          </div>
          {form.formState.errors.rating && (
            <p className="text-red-500 text-sm">{form.formState.errors.rating.message}</p>
          )}

          <Textarea
            placeholder="Write your review..."
            {...form.register("comment")}
          />
          {form.formState.errors.comment && (
            <p className="text-red-500 text-sm">{form.formState.errors.comment.message}</p>
          )}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit review"}
          </Button>
        </form>
      ) : (
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg text-center">
          <p>Please log in to leave a review.</p>
        </div>
      )}

      <div className="space-y-6">
        {isLoading ? (
          <p>Loading reviews...</p>
        ) : reviews.length === 0 ? (
          <p className="text-gray-500">No reviews yet. Be the first to leave one!</p>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="border-b pb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                  {review.user.image ? (
                    <StoreImage
                      src={review.user.image}
                      alt={review.user.name || "User"}
                      width={32}
                      height={32}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5 text-gray-500" />
                  )}
                </div>
                <span className="font-medium">{review.user.name || "User"}</span>
                <span className="text-gray-400 text-sm ml-auto">
                  {new Date(review.createdAt).toLocaleDateString("en-US")}
                </span>
                {session?.user?.role === "ADMIN" && (
                  <button
                    onClick={() => handleDeleteReview(review.id)}
                    className="text-red-500 hover:text-red-700 ml-2 focus:outline-none"
                    title="Delete review"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex mb-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-4 h-4 ${star <= review.rating
                      ? "text-yellow-400 fill-yellow-400"
                      : "text-gray-300"
                      }`}
                  />
                ))}
              </div>
              <p className="text-gray-700 dark:text-gray-300 break-words whitespace-pre-wrap overflow-hidden">{review.comment}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
