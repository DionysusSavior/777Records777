# Asset bucket CORS

`777records777productpageassets` holds the audio the OM7 card streams. The
bucket already serves the bytes; what it does not do by default is say who is
allowed to read them from script, and that one missing header decides whether
OM7's download button can save a file or can only open it in a tab.

## Why it is needed

Browsers ignore the `download` attribute on a link to another domain. The
whole point of the OM7 intro track is that the file lives on the artist's own
host, so every one of them is another domain — which means the only way to
hand somebody a named file is to fetch the bytes and build a blob, and a
cross-origin fetch needs `Access-Control-Allow-Origin`.

Without it the track still plays. `<audio>` does not need CORS to play a file,
because it never exposes the bytes to script. Only the save does.

`ExposeHeaders` carries the range headers through, which is what lets a player
seek instead of buffering from zero.

## Applying it

The configuration must be wrapped in a `CORSRules` object. A bare array is
what the S3 console shows and what the CLI rejects.

```
aws s3api put-bucket-cors \
  --bucket 777records777productpageassets \
  --cors-configuration file://infra/s3-cors-assets.json \
  --region us-east-2
```

Check it took, and note that the header only appears when an `Origin` is sent:

```
curl -sI -H "Origin: https://om7.foundation" \
  "https://777records777productpageassets.s3.us-east-2.amazonaws.com/New+Deal-+master.wav" \
  | grep -i access-control
```

## The bucket already had CORS

It was not missing, it was incomplete — two origins were allowed, the Render
deployment and 777records777.studio, and om7.foundation was not one of them.
That is why the fetch failed from the card, and it is a different problem from
the one the absence of headers suggested. `put-bucket-cors` REPLACES the whole
configuration rather than adding to it, so the file here carries all three
origins; writing only the new one would have taken the storefront's own access
away.

## Named origins rather than `*`

`*` would work and is what OM7 tells other artists to use, because most of
them are on a host where a wildcard is the only setting available and a
listable bucket of public audio is not worth a lecture. This bucket is ours,
the three sites that read it are known, and there is no reason to let every
other page on the internet pull these files through script.

## The other half: the file is a 44 MB wav

`New Deal- master.wav` is 43.9 MB. Every play pulls all of it, and on a phone
it stalls before it starts. The same track as a 192 kbps mp3 is about 4 MB.
Convert it and point the card at the mp3; keep the wav in the bucket for
anyone who wants the master.

```
ffmpeg -i "New Deal- master.wav" -codec:a libmp3lame -b:a 192k "new-deal.mp3"
```
