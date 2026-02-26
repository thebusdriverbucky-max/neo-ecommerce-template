"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Star, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";

const reviewSchema = z.object({
  rating: z.number().min(1, "Выберите оценку").max(5),
  comment: z.string().min(5, "Комментарий должен содержать минимум 5 символов"),
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
}

export const ProductReviews = ({ productId }: ProductReviewsProps) => {
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

  const fetchReviews = async () => {
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
  };

  useEffect(() => {
    fetchReviews();
  }, [productId]);

  const onSubmit = async (data: ReviewFormValues) => {
    if (!session) {
      toast.error("Пожалуйста, войдите, чтобы оставить отзыв");
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

      if (!res.ok) throw new Error("Failed to submit review");

      toast.success("Отзыв добавлен!");
      form.reset();
      fetchReviews();
    } catch (error) {
      toast.error("Не удалось добавить отзыв");
    } finally {
      setIsSubmitting(false);
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
          {averageRating.toFixed(1)} из 5
        </span>
      </div>

      {session ? (
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
            placeholder="Напишите ваш отзыв..."
            {...form.register("comment")}
          />
          {form.formState.errors.comment && (
            <p className="text-red-500 text-sm">{form.formState.errors.comment.message}</p>
          )}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Отправка..." : "Отправить отзыв"}
          </Button>
        </form>
      ) : (
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg text-center">
          <p>Пожалуйста, войдите, чтобы оставить отзыв.</p>
        </div>
      )}

      <div className="space-y-6">
        {isLoading ? (
          <p>Загрузка отзывов...</p>
        ) : reviews.length === 0 ? (
          <p className="text-gray-500">Пока нет отзывов. Будьте первым!</p>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="border-b pb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                  {review.user.image ? (
                    <img src={review.user.image} alt={review.user.name || "User"} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-gray-500" />
                  )}
                </div>
                <span className="font-medium">{review.user.name || "Пользователь"}</span>
                <span className="text-gray-400 text-sm ml-auto">
                  {new Date(review.createdAt).toLocaleDateString()}
                </span>
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
              <p className="text-gray-700 dark:text-gray-300">{review.comment}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

