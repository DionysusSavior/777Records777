# The Site Manager storage identity

The Medusa backend needs to do exactly two things to the artist's bucket:
sign a one-object PUT, and read that object's headers back. Nothing else.

`site-manager-s3-policy.json` is that permission and no more.

## Why it is only two actions

- **`s3:PutObject`** — issuing the presigned upload. The signature the backend
  hands the phone can only be as strong as the identity that signed it, so this
  identity is the ceiling on what a stolen upload URL could ever do.
- **`s3:GetObject`** — `HeadObject` is authorised as `GetObject`, and completion
  cannot verify the stored length, type and checksum without it. This is not
  the backend downloading media; it reads headers only.

## What is deliberately absent, and what each would cost

- **`s3:ListBucket`** — without it, a leaked credential cannot enumerate what
  the artist has ever published. Absence turns a listing into a guessing game.
- **`s3:DeleteObject`** — a compromise cannot destroy an artist's media. The
  backend never needs it: nothing in the protocol deletes.
- **Any other prefix, and any other bucket.** The resource ARN stops at
  `site-manager/*`. The bucket also holds the release bundles and product page
  assets, and this identity must not be able to overwrite a master.

`PutObject` on this prefix does allow overwriting an object at a key the holder
already knows. That is bounded by the keys being random UUIDs, which is the
same reason the protocol refuses to use the phone's filename.

## ARTIST is a placeholder, and substituting it is the whole point

The resource ends `/site-manager/ARTIST/*`. Replace `ARTIST` with that one
person's handle - `dion`, `viz` - and mint a separate user for each.

**A shared `site-manager/*` is a bug, not a shortcut.** The first version of
this file granted exactly that, which would have let any artist holding a key
overwrite any other artist's manifest and media. One prefix per person is what
buys the three properties the design claims: nobody can overwrite anybody, one
person can be revoked without rotating everyone, and two phones can never race
on one manifest because no two phones write the same one.

## Creating it

These steps mint a credential, so they are Dion's to run, not an agent's.

    ARTIST=dion   # one per person, never shared
    sed "s/ARTIST/$ARTIST/" infra/site-manager-s3-policy.json > /tmp/$ARTIST-policy.json

    aws iam create-user --user-name om7-site-manager-$ARTIST
    aws iam put-user-policy \
      --user-name om7-site-manager-$ARTIST \
      --policy-name site-manager-s3 \
      --policy-document file:///tmp/$ARTIST-policy.json
    aws iam create-access-key --user-name om7-site-manager-$ARTIST

The last command prints the only copy of the secret. Put the two values
straight into Render as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` and do
not paste them anywhere else - not into a file, a chat, or a commit.

## The standing weakness, stated plainly

This is a long-lived static credential sitting in a third-party dashboard, and
it is the weakest link in an otherwise short-lived design: every other secret
in Site Manager either expires in minutes or is a one-way digest. Rotate it on
a schedule. If Render ever supports OIDC federation to AWS, this identity is
the first thing that should move to it.
