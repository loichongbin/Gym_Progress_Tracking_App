import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,24}$/, "3–24 characters: letters, numbers, dots and underscores");

export const signUpSchema = z.object({
  full_name: z.string().trim().min(1, "Tell us your name").max(60),
  username: usernameSchema,
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

export const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(60),
  username: usernameSchema,
  bio: z.string().max(280, "Keep it under 280 characters"),
  location: z.string().max(60),
  gym: z.string().max(80),
  interests: z.string().max(200),
});

export const communitySchema = z.object({
  name: z.string().trim().min(3, "At least 3 characters").max(60),
  description: z.string().trim().max(500),
  tags: z.string().max(120),
  is_private: z.boolean(),
});

export const exerciseSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60),
  muscle_group: z.string().min(1),
  equipment: z.string().min(1),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export const emailSchema = z.object({ email: z.email("Enter a valid email") });
