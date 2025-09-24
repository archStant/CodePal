# CodePal

You can have as many levels (numbered directories) as you please, and the pal will chose an image from an appropriate level, depending on the number of errors in your code.

Images from directory 0 will always be chosen when there are no errors, and images from the directory with the highest number will be chosen when there are more errors than your panic limit. Set the panic limit with the `codepal.setPanicLimit` command (default is 20).